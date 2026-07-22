#!/usr/bin/env python3
"""
Extract TSK cross-references and build a hierarchical graph structure.
Creates a 3-level hierarchy: Book -> Chapter -> Verse
Outputs nodes.json and edges.json for visualization.
"""
import json
import re
import subprocess
from dataclasses import dataclass, asdict
from typing import List, Dict, Set, Optional
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

# ------------------------------------------------------------
# CONFIG
# ------------------------------------------------------------

TSK_MODULE = "TSK"
DIATHEKE_CMD = "diatheke"
OUTPUT_DIR = "graph_data"
OUTPUT_SUMMARY = "graph_data/summary.json"

# ------------------------------------------------------------
# DATA STRUCTURES
# ------------------------------------------------------------

@dataclass
class Node:
    id: str
    label: str
    type: str  # "book", "chapter", or "verse"
    testament: str  # "NT" or "OT"
    book: Optional[str] = None
    chapter: Optional[int] = None
    verse: Optional[int] = None
    
@dataclass
class Edge:
    source: str
    target: str

# ------------------------------------------------------------
# BIBLE DATA
# ------------------------------------------------------------

NT_BOOKS = [
    "Matthew", "Mark", "Luke", "John", "Acts",
    "Romans", "1 Corinthians", "2 Corinthians", "Galatians",
    "Ephesians", "Philippians", "Colossians",
    "1 Thessalonians", "2 Thessalonians",
    "1 Timothy", "2 Timothy", "Titus", "Philemon",
    "Hebrews", "James",
    "1 Peter", "2 Peter",
    "1 John", "2 John", "3 John",
    "Jude", "Revelation"
]

NT_CHAPTER_COUNTS = {
    "Matthew": 28, "Mark": 16, "Luke": 24, "John": 21, "Acts": 28,
    "Romans": 16, "1 Corinthians": 16, "2 Corinthians": 13, "Galatians": 6,
    "Ephesians": 6, "Philippians": 4, "Colossians": 4,
    "1 Thessalonians": 5, "2 Thessalonians": 3,
    "1 Timothy": 6, "2 Timothy": 4, "Titus": 3, "Philemon": 1,
    "Hebrews": 13, "James": 5,
    "1 Peter": 5, "2 Peter": 3,
    "1 John": 5, "2 John": 1, "3 John": 1,
    "Jude": 1, "Revelation": 22,
}

APPROX_MAX_VERSES = 40

# ------------------------------------------------------------
# DIATHEKE WRAPPER
# ------------------------------------------------------------

def run_diatheke(module: str, key: str) -> str:
    try:
        result = subprocess.run(
            [DIATHEKE_CMD, "-b", module, "-k", key],
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        raise RuntimeError(
            f"Could not find diatheke command '{DIATHEKE_CMD}'. "
            f"Install SWORD/diatheke and ensure it is on PATH."
        )
    return result.stdout.strip()

# ------------------------------------------------------------
# PARSING
# ------------------------------------------------------------

def parse_tsk_references(raw: str) -> List[str]:
    """
    Extract clean cross-references from TSK output.
    Removes HTML tags, commentary text, and extracts just verse references.
    """
    if not raw:
        return []
    
    # Remove all HTML/XML tags
    text = re.sub(r'<[^>]+>', ' ', raw)
    
    # Remove the leading verse label (e.g., "John 1:1:")
    text = re.sub(r'^[^:]+:\s*', '', text)
    
    # Remove common TSK markers
    text = re.sub(r'\(TSK\)', '', text)
    
    # Split on semicolons and commas
    parts = re.split(r'[;,]', text)
    
    refs = []
    seen = set()
    
    for part in parts:
        piece = part.strip()
        if not piece:
            continue
            
        # Look for verse references (must have chapter:verse pattern)
        # Match patterns like "Ge 1:1" or "1 Cor 15:3-5" or "Ps 119:105"
        match = re.search(r'([1-3]?\s*[A-Za-z]+)\s+(\d+):(\d+)(?:-\d+)?', piece)
        if match:
            # Normalize the book abbreviation and format
            book = match.group(1).strip()
            chapter = match.group(2)
            verse = match.group(3)
            ref = f"{book} {chapter}:{verse}"
            
            if ref not in seen:
                refs.append(ref)
                seen.add(ref)
    
    return refs

def normalize_book_name(abbr: str) -> Optional[str]:
    """
    Normalize book abbreviations to full names.
    Returns None if not recognized.
    """
    abbr_lower = abbr.lower().replace('.', '').replace(' ', '')
    
    book_map = {
        # OT
        'ge': 'Genesis', 'gen': 'Genesis', 'genesis': 'Genesis',
        'ex': 'Exodus', 'exo': 'Exodus', 'exodus': 'Exodus',
        'le': 'Leviticus', 'lev': 'Leviticus', 'leviticus': 'Leviticus',
        'nu': 'Numbers', 'num': 'Numbers', 'numbers': 'Numbers',
        'de': 'Deuteronomy', 'deu': 'Deuteronomy', 'dt': 'Deuteronomy', 'deuteronomy': 'Deuteronomy',
        'jos': 'Joshua', 'josh': 'Joshua', 'joshua': 'Joshua',
        'jdg': 'Judges', 'judg': 'Judges', 'judges': 'Judges',
        'ru': 'Ruth', 'rut': 'Ruth', 'ruth': 'Ruth',
        '1sa': '1 Samuel', '1sam': '1 Samuel', '1samuel': '1 Samuel',
        '2sa': '2 Samuel', '2sam': '2 Samuel', '2samuel': '2 Samuel',
        '1ki': '1 Kings', '1kgs': '1 Kings', '1kings': '1 Kings',
        '2ki': '2 Kings', '2kgs': '2 Kings', '2kings': '2 Kings',
        '1ch': '1 Chronicles', '1chr': '1 Chronicles', '1chronicles': '1 Chronicles',
        '2ch': '2 Chronicles', '2chr': '2 Chronicles', '2chronicles': '2 Chronicles',
        'ezr': 'Ezra', 'ezra': 'Ezra',
        'ne': 'Nehemiah', 'neh': 'Nehemiah', 'nehemiah': 'Nehemiah',
        'es': 'Esther', 'est': 'Esther', 'esther': 'Esther',
        'job': 'Job',
        'ps': 'Psalms', 'psa': 'Psalms', 'psalm': 'Psalms', 'psalms': 'Psalms',
        'pr': 'Proverbs', 'pro': 'Proverbs', 'prov': 'Proverbs', 'proverbs': 'Proverbs',
        'ec': 'Ecclesiastes', 'ecc': 'Ecclesiastes', 'ecclesiastes': 'Ecclesiastes',
        'so': 'Song of Solomon', 'sos': 'Song of Solomon', 'song': 'Song of Solomon',
        'isa': 'Isaiah', 'is': 'Isaiah', 'isaiah': 'Isaiah',
        'jer': 'Jeremiah', 'je': 'Jeremiah', 'jeremiah': 'Jeremiah',
        'la': 'Lamentations', 'lam': 'Lamentations', 'lamentations': 'Lamentations',
        'eze': 'Ezekiel', 'ezk': 'Ezekiel', 'ezekiel': 'Ezekiel',
        'da': 'Daniel', 'dan': 'Daniel', 'daniel': 'Daniel',
        'ho': 'Hosea', 'hos': 'Hosea', 'hosea': 'Hosea',
        'joe': 'Joel', 'joel': 'Joel',
        'am': 'Amos', 'amos': 'Amos',
        'ob': 'Obadiah', 'oba': 'Obadiah', 'obadiah': 'Obadiah',
        'jon': 'Jonah', 'jonah': 'Jonah',
        'mic': 'Micah', 'mi': 'Micah', 'micah': 'Micah',
        'na': 'Nahum', 'nah': 'Nahum', 'nahum': 'Nahum',
        'hab': 'Habakkuk', 'habakkuk': 'Habakkuk',
        'zep': 'Zephaniah', 'zephaniah': 'Zephaniah',
        'hag': 'Haggai', 'haggai': 'Haggai',
        'zec': 'Zechariah', 'zec': 'Zechariah', 'zechariah': 'Zechariah',
        'mal': 'Malachi', 'malachi': 'Malachi',
        
        # NT
        'mt': 'Matthew', 'mat': 'Matthew', 'matt': 'Matthew', 'matthew': 'Matthew',
        'mk': 'Mark', 'mar': 'Mark', 'mark': 'Mark',
        'lu': 'Luke', 'luk': 'Luke', 'lk': 'Luke', 'luke': 'Luke',
        'joh': 'John', 'jn': 'John', 'john': 'John',
        'ac': 'Acts', 'act': 'Acts', 'acts': 'Acts',
        'ro': 'Romans', 'rom': 'Romans', 'romans': 'Romans',
        '1co': '1 Corinthians', '1cor': '1 Corinthians', '1corinthians': '1 Corinthians',
        '2co': '2 Corinthians', '2cor': '2 Corinthians', '2corinthians': '2 Corinthians',
        'ga': 'Galatians', 'gal': 'Galatians', 'galatians': 'Galatians',
        'eph': 'Ephesians', 'ephesians': 'Ephesians',
        'php': 'Philippians', 'phi': 'Philippians', 'phil': 'Philippians', 'philippians': 'Philippians',
        'col': 'Colossians', 'colossians': 'Colossians',
        '1th': '1 Thessalonians', '1thess': '1 Thessalonians', '1thessalonians': '1 Thessalonians',
        '2th': '2 Thessalonians', '2thess': '2 Thessalonians', '2thessalonians': '2 Thessalonians',
        '1ti': '1 Timothy', '1tim': '1 Timothy', '1timothy': '1 Timothy',
        '2ti': '2 Timothy', '2tim': '2 Timothy', '2timothy': '2 Timothy',
        'tit': 'Titus', 'titus': 'Titus',
        'phm': 'Philemon', 'philemon': 'Philemon',
        'heb': 'Hebrews', 'hebrews': 'Hebrews',
        'jas': 'James', 'jam': 'James', 'james': 'James',
        '1pe': '1 Peter', '1pet': '1 Peter', '1peter': '1 Peter',
        '2pe': '2 Peter', '2pet': '2 Peter', '2peter': '2 Peter',
        '1jo': '1 John', '1jn': '1 John', '1john': '1 John',
        '2jo': '2 John', '2jn': '2 John', '2john': '2 John',
        '3jo': '3 John', '3jn': '3 John', '3john': '3 John',
        'jude': 'Jude',
        're': 'Revelation', 'rev': 'Revelation', 'revelation': 'Revelation',
    }
    
    return book_map.get(abbr_lower)

def parse_verse_ref(ref: str) -> Optional[tuple]:
    """
    Parse a reference like "Ge 1:1" into (book, chapter, verse).
    Returns None if can't parse.
    """
    match = re.match(r'([1-3]?\s*[A-Za-z]+)\s+(\d+):(\d+)', ref.strip())
    if not match:
        return None
    
    book_abbr = match.group(1).strip()
    chapter = int(match.group(2))
    verse = int(match.group(3))
    
    book = normalize_book_name(book_abbr)
    if not book:
        return None
    
    return (book, chapter, verse)

def get_testament(book: str) -> str:
    """Determine if a book is NT or OT."""
    return "NT" if book in NT_BOOKS else "OT"

# ------------------------------------------------------------
# ------------------------------------------------------------
# MAIN EXTRACTION
# ------------------------------------------------------------

def process_verse(book: str, chapter: int, verse_num: int) -> Optional[Dict]:
    """
    Process a single verse and return its data (nodes, edges).
    Returns None if verse doesn't exist.
    """
    verse_key = f"{book} {chapter}:{verse_num}"
    
    # Query TSK
    raw = run_diatheke(TSK_MODULE, verse_key)
    
    if not raw or "is not a valid verse" in raw.lower():
        return None
    
    # Parse references
    refs = parse_tsk_references(raw)
    
    if not refs:
        return {"verse_key": verse_key, "refs": []}
    
    return {"verse_key": verse_key, "refs": refs}


def process_chapter(book: str, chapter: int) -> List[Dict]:
    """
    Process all verses in a chapter using parallel processing.
    Returns list of verse data.
    """
    results = []
    missing_streak = 0
    
    # Use thread pool for verse-level parallelism
    with ThreadPoolExecutor(max_workers=10) as executor:
        # Submit batches of verses
        future_to_verse = {}
        for verse_num in range(1, APPROX_MAX_VERSES + 1):
            future = executor.submit(process_verse, book, chapter, verse_num)
            future_to_verse[future] = verse_num
        
        # Collect results in order
        verse_data = {}
        for future in as_completed(future_to_verse):
            verse_num = future_to_verse[future]
            result = future.result()
            if result:
                verse_data[verse_num] = result
        
        # Convert to ordered list and detect end of chapter
        for verse_num in range(1, APPROX_MAX_VERSES + 1):
            if verse_num in verse_data:
                results.append(verse_data[verse_num])
                missing_streak = 0
            else:
                missing_streak += 1
                if missing_streak >= 3:
                    break
    
    return results


def extract_graph_data() -> Dict[str, Dict]:
    """
    Extract all TSK cross-references and build hierarchical graph structure.
    Returns data organized by book: {book_name: {nodes: [], edges: []}}
    """
    book_data = {}
    
    for book in NT_BOOKS:
        nodes: Dict[str, Node] = {}
        edges_set: Set[tuple] = set()
        nodes_lock = Lock()
        edges_lock = Lock()
        
        max_chapters = NT_CHAPTER_COUNTS[book]
        print(f"Processing {book} ({max_chapters} chapters)...")
        
        # Create book node
        book_id = f"book:{book}"
        nodes[book_id] = Node(
            id=book_id,
            label=book,
            type="book",
            testament="NT",
            book=book
        )
        
        # Process chapters in parallel
        with ThreadPoolExecutor(max_workers=4) as executor:
            chapter_futures = {}
            for chapter in range(1, max_chapters + 1):
                future = executor.submit(process_chapter, book, chapter)
                chapter_futures[future] = chapter
            
            for future in as_completed(chapter_futures):
                chapter = chapter_futures[future]
                verse_results = future.result()
                
                if not verse_results:
                    continue
                
                chapter_id = f"chapter:{book}_{chapter}"
                
                # Create chapter node
                with nodes_lock:
                    nodes[chapter_id] = Node(
                        id=chapter_id,
                        label=f"{book} {chapter}",
                        type="chapter",
                        testament="NT",
                        book=book,
                        chapter=chapter
                    )
                
                with edges_lock:
                    # Link chapter to book
                    edges_set.add((chapter_id, book_id))
                
                # Process each verse in the chapter
                for verse_data in verse_results:
                    verse_key = verse_data["verse_key"]
                    refs = verse_data["refs"]
                    
                    # Parse verse number from key
                    match = re.search(r':(\d+)$', verse_key)
                    verse_num = int(match.group(1)) if match else 0
                    
                    # Create verse node
                    verse_id = f"verse:{verse_key}"
                    with nodes_lock:
                        nodes[verse_id] = Node(
                            id=verse_id,
                            label=verse_key,
                            type="verse",
                            testament="NT",
                            book=book,
                            chapter=chapter,
                            verse=verse_num
                        )
                    
                    with edges_lock:
                        # Link verse to chapter
                        edges_set.add((verse_id, chapter_id))
                    
                    print(f"  {verse_key}: {len(refs)} references")
                    
                    # Process cross-references
                    for ref in refs:
                        parsed = parse_verse_ref(ref)
                        if not parsed:
                            continue
                        
                        ref_book, ref_chapter, ref_verse = parsed
                        ref_testament = get_testament(ref_book)
                        
                        # Create target book node
                        target_book_id = f"book:{ref_book}"
                        with nodes_lock:
                            if target_book_id not in nodes:
                                nodes[target_book_id] = Node(
                                    id=target_book_id,
                                    label=ref_book,
                                    type="book",
                                    testament=ref_testament,
                                    book=ref_book
                                )
                        
                        # Create target chapter node
                        target_chapter_id = f"chapter:{ref_book}_{ref_chapter}"
                        with nodes_lock:
                            if target_chapter_id not in nodes:
                                nodes[target_chapter_id] = Node(
                                    id=target_chapter_id,
                                    label=f"{ref_book} {ref_chapter}",
                                    type="chapter",
                                    testament=ref_testament,
                                    book=ref_book,
                                    chapter=ref_chapter
                                )
                        
                        with edges_lock:
                            # Link chapter to book
                            edges_set.add((target_chapter_id, target_book_id))
                        
                        # Create target verse node
                        target_verse_key = f"{ref_book} {ref_chapter}:{ref_verse}"
                        target_verse_id = f"verse:{target_verse_key}"
                        with nodes_lock:
                            if target_verse_id not in nodes:
                                nodes[target_verse_id] = Node(
                                    id=target_verse_id,
                                    label=target_verse_key,
                                    type="verse",
                                    testament=ref_testament,
                                    book=ref_book,
                                    chapter=ref_chapter,
                                    verse=ref_verse
                                )
                        
                        with edges_lock:
                            # Link verse to chapter
                            edges_set.add((target_verse_id, target_chapter_id))
                            # Create cross-reference edge (verse to verse)
                            edges_set.add((verse_id, target_verse_id))
        
        # Convert to lists
        edges = [Edge(source=src, target=tgt) for src, tgt in edges_set]
        
        book_data[book] = {
            "nodes": [asdict(n) for n in nodes.values()],
            "edges": [asdict(e) for e in edges]
        }
    
    return book_data

def main() -> None:
    import os
    
    print("Extracting TSK cross-references for hierarchical graph visualization...")
    print("Structure: Books → Chapters → Verses")
    print("Output: One JSON file per book\n")
    
    book_data = extract_graph_data()
    
    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Summary stats
    summary = {
        "books": [],
        "total_nodes": 0,
        "total_edges": 0
    }
    
    # Write each book to its own file
    for book, data in book_data.items():
        filename = book.replace(" ", "_") + ".json"
        filepath = os.path.join(OUTPUT_DIR, filename)
        
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        node_count = len(data["nodes"])
        edge_count = len(data["edges"])
        
        summary["books"].append({
            "name": book,
            "file": filename,
            "nodes": node_count,
            "edges": edge_count
        })
        summary["total_nodes"] += node_count
        summary["total_edges"] += edge_count
        
        print(f"✓ {book}: {node_count} nodes, {edge_count} edges → {filepath}")
    
    # Write summary file
    with open(OUTPUT_SUMMARY, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    
    print(f"\n✓ Summary written to {OUTPUT_SUMMARY}")
    print(f"\nTotal: {len(book_data)} books, {summary['total_nodes']} nodes, {summary['total_edges']} edges")
    print("\n✓ Hierarchical graph data extraction complete!")

if __name__ == "__main__":
    main()
