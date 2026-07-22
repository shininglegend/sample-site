#!/usr/bin/env python3
"""
Extract hierarchical graph data with chapters as base level.
Shows chapter-to-chapter connections, with drill-down to verses.
"""

import json
from pathlib import Path
from collections import defaultdict

def extract_hierarchical_data():
    """Extract chapter-level graph with verse drill-down."""
    graph_dir = Path('graph_data')
    
    # Chapter-to-chapter aggregated connections
    chapter_connections = defaultdict(lambda: defaultdict(int))
    
    # Store verse-level details for each chapter (for drill-down)
    chapter_verses = defaultdict(lambda: {'nodes': [], 'links': []})
    
    # All chapter nodes
    all_chapters = {}
    
    # Process each book file
    for book_file in sorted(graph_dir.glob('*.json')):
        if book_file.name == 'summary.json':
            continue
            
        print(f"Processing {book_file.name}...")
        
        with open(book_file) as f:
            data = json.load(f)
        
        # Build lookup
        node_lookup = {n['id']: n for n in data['nodes']}
        
        # Collect chapter nodes
        for node in data['nodes']:
            if node['type'] == 'chapter':
                chapter_id = node['label']
                all_chapters[chapter_id] = {
                    'id': chapter_id,
                    'book': node['book'],
                    'chapter': node['chapter'],
                    'testament': node['testament']
                }
        
        # Process verse-to-verse edges
        for edge in data['edges']:
            source_node = node_lookup.get(edge['source'])
            target_node = node_lookup.get(edge['target'])
            
            if not source_node or not target_node:
                continue
            
            # Only process verse-to-verse connections
            if source_node['type'] != 'verse' or target_node['type'] != 'verse':
                continue
            
            source_chapter = f"{source_node['book']} {source_node['chapter']}"
            target_chapter = f"{target_node['book']} {target_node['chapter']}"
            
            # Aggregate at chapter level
            chapter_connections[source_chapter][target_chapter] += 1
            
            # Store verse-level data for drill-down
            # Add source verse to its chapter
            if source_node not in [n['id'] for n in chapter_verses[source_chapter]['nodes']]:
                chapter_verses[source_chapter]['nodes'].append({
                    'id': source_node['id'],
                    'label': source_node['label'],
                    'verse': source_node['verse']
                })
            
            # Add target verse (might be in different chapter)
            if target_node['id'] not in [n['id'] for n in chapter_verses[source_chapter]['nodes']]:
                chapter_verses[source_chapter]['nodes'].append({
                    'id': target_node['id'],
                    'label': target_node['label'],
                    'verse': target_node.get('verse'),
                    'external': target_chapter != source_chapter
                })
            
            # Add the verse-level link
            chapter_verses[source_chapter]['links'].append({
                'source': source_node['id'],
                'target': target_node['id'],
                'target_chapter': target_chapter
            })
    
    # Build output structure
    output = {
        'chapters': {
            'nodes': list(all_chapters.values()),
            'links': []
        },
        'verse_details': {}  # chapter_id -> {nodes, links}
    }
    
    # Add chapter-to-chapter links
    for source_chapter, targets in chapter_connections.items():
        for target_chapter, count in targets.items():
            if count >= 1:  # Keep all connections at chapter level
                output['chapters']['links'].append({
                    'source': source_chapter,
                    'target': target_chapter,
                    'weight': count
                })
    
    # Add verse details for each chapter
    for chapter_id, details in chapter_verses.items():
        output['verse_details'][chapter_id] = details
    
    # Save output
    output_file = graph_dir / 'hierarchical.json'
    with open(output_file, 'w') as f:
        json.dump(output, f, indent=2)
    
    print(f"\nHierarchical data saved to {output_file}")
    print(f"Chapters: {len(output['chapters']['nodes'])} nodes")
    print(f"Chapter-to-chapter links: {len(output['chapters']['links'])}")
    print(f"Chapters with verse details: {len(output['verse_details'])}")

if __name__ == '__main__':
    extract_hierarchical_data()
