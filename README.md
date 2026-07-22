# Scripture Graph Visualization

Interactive graph visualization of cross-references in the New Testament using the Treasury of Scripture Knowledge (TSK).

## Graph Statistics

### Dataset Scale
- **Total chapters**: 1,150 chapters across Old and New Testament
- **Chapter-to-chapter links**: 48,590 connections
- **New Testament**: 260 chapters
- **Old Testament**: 890 chapters

### Connection Distribution
- **Range**: 1 to 1,491 connections per chapter
- **Average**: 142.1 connections per chapter
- **Median**: 28 connections

### Most Cross-Referenced Chapters
The chapters with the most intertextual connections:

1. **1 Peter 1** - 1,491 connections
2. **Colossians 1** - 1,414 connections
3. **Ephesians 1** - 1,161 connections
4. **Ephesians 4** - 1,123 connections
5. **1 Peter 2** - 1,105 connections
6. **Romans 1** - 1,082 connections
7. **Jude 1** - 1,076 connections
8. **Philippians 1** - 1,032 connections
9. **Philippians 2** - 1,009 connections
10. **Romans 8** - 1,001 connections

### Link Characteristics
- **Link weight range**: 1 to 30 connections between chapter pairs
- **Average weight**: 1.7 connections per link
- **Heavy links** (10+ connections): 192 pairs

### Strongest Chapter-to-Chapter Connections
The most densely cross-referenced chapter pairs:

1. **Ephesians 1 ↔ Colossians 1** - 30 connections
2. **Mark 15 ↔ Matthew 27** - 29 connections (parallel passion narratives)
3. **Ephesians 3 ↔ Colossians 1** - 28 connections
4. **Ephesians 2 ↔ Colossians 1** - 27 connections
5. **Mark 15 ↔ Luke 23** - 26 connections

## Data Source

Treasury of Scripture Knowledge (TSK) via the `diatheke` command-line tool from the SWORD Project.

## Files

- `extract_graph.py` - Original extraction (verse-level)
- `extract_hierarchical.py` - Hierarchical extraction (chapter-level with verse drill-down)c
- `graph_data/hierarchical.json` - Processed graph data
