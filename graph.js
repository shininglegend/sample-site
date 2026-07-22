/**
 * Scripture Graph Visualization
 * Interactive network visualization of biblical cross-references
 * 
 * Uses D3.js for data processing and force-graph for WebGL rendering
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Node colors by testament
  colors: {
    NT: '#facc15',      // Yellow for New Testament
    OT: '#60a5fa',      // Blue for Old Testament
    verse: '#94a3b8',   // Gray for verses
    external: '#64748b', // Darker gray for external verse refs
    link: '#475569',    // Default link color
    linkHighlight: '#facc15', // Highlighted link
    background: '#020617'
  },
  
  // Node sizing
  nodeSize: {
    minRadius: 3,
    maxRadius: 20,
    // Scale based on total connection weight
    scale: (weight, maxWeight) => {
      const normalized = Math.sqrt(weight / maxWeight);
      return CONFIG.nodeSize.minRadius + normalized * (CONFIG.nodeSize.maxRadius - CONFIG.nodeSize.minRadius);
    }
  },
  
  // Link styling
  link: {
    minWidth: 0.3,
    maxWidth: 4,
    scale: (weight, maxWeight) => {
      const normalized = Math.sqrt(weight / maxWeight);
      return CONFIG.link.minWidth + normalized * (CONFIG.link.maxWidth - CONFIG.link.minWidth);
    }
  },
  
  // Force simulation parameters
  physics: {
    chapters: {
      charge: -150,
      linkDistance: 80,
      centerStrength: 0.05
    },
    verses: {
      charge: -30,
      linkDistance: 40,
      centerStrength: 0.1
    }
  }
};

// ============================================================================
// STATE
// ============================================================================

let graphData = null;           // Full hierarchical data
let graph = null;               // ForceGraph instance
let currentView = 'chapters';   // 'chapters' or 'verses'
let expandedChapter = null;     // Currently expanded chapter ID
let nodeMetrics = new Map();    // Pre-computed node metrics (degree, weight)
let highlightNodes = new Set(); // Nodes to highlight (from search)
let hoverNode = null;           // Currently hovered node

// ============================================================================
// DOM ELEMENTS
// ============================================================================

const elements = {
  container: () => document.getElementById('graph-container'),
  loading: () => document.getElementById('loading-overlay'),
  loadingStatus: () => document.getElementById('loading-status'),
  tooltip: () => document.getElementById('tooltip'),
  searchInput: () => document.getElementById('search-input'),
  testamentFilter: () => document.getElementById('testament-filter'),
  weightThreshold: () => document.getElementById('weight-threshold'),
  weightValue: () => document.getElementById('weight-value'),
  currentView: () => document.getElementById('current-view'),
  backBtn: () => document.getElementById('back-btn'),
  instructions: () => document.getElementById('instructions'),
  dismissInstructions: () => document.getElementById('dismiss-instructions'),
  legendContent: () => document.getElementById('legend-content'),
  statLabel1: () => document.getElementById('stat-label-1'),
  statLabel2: () => document.getElementById('stat-label-2'),
  stats: {
    nodes: () => document.getElementById('stat-nodes'),
    links: () => document.getElementById('stat-links'),
    nt: () => document.getElementById('stat-nt'),
    ot: () => document.getElementById('stat-ot')
  }
};

// ============================================================================
// DATA LOADING & PROCESSING
// ============================================================================

async function loadData() {
  updateLoadingStatus('Fetching cross-reference data...');
  
  try {
    const response = await fetch('graph_data/hierarchical.json');
    if (!response.ok) throw new Error('Failed to load data');
    
    updateLoadingStatus('Parsing graph structure...');
    graphData = await response.json();
    
    updateLoadingStatus('Computing node metrics...');
    computeNodeMetrics();
    
    updateLoadingStatus('Initializing visualization...');
    return true;
  } catch (error) {
    console.error('Error loading data:', error);
    updateLoadingStatus('Error loading data. Please refresh.');
    return false;
  }
}

function computeNodeMetrics() {
  // Compute degree and total weight for each chapter node
  const metrics = new Map();
  
  // Initialize all nodes
  for (const node of graphData.chapters.nodes) {
    metrics.set(node.id, { degree: 0, totalWeight: 0, testament: node.testament });
  }
  
  // Aggregate from links
  for (const link of graphData.chapters.links) {
    const sourceMetrics = metrics.get(link.source);
    const targetMetrics = metrics.get(link.target);
    
    if (sourceMetrics) {
      sourceMetrics.degree++;
      sourceMetrics.totalWeight += link.weight;
    }
    if (targetMetrics) {
      targetMetrics.degree++;
      targetMetrics.totalWeight += link.weight;
    }
  }
  
  nodeMetrics = metrics;
}

function updateLoadingStatus(message) {
  const el = elements.loadingStatus();
  if (el) el.textContent = message;
}

function hideLoading() {
  const el = elements.loading();
  if (el) el.classList.add('hidden');
}

// ============================================================================
// GRAPH RENDERING
// ============================================================================

function initGraph() {
  const container = elements.container();
  if (!container) return;
  
  // Get max weight for scaling
  const maxWeight = Math.max(...Array.from(nodeMetrics.values()).map(m => m.totalWeight));
  const maxLinkWeight = Math.max(...graphData.chapters.links.map(l => l.weight));
  
  // Prepare initial data
  const { nodes, links } = getFilteredChapterData();
  
  // Create ForceGraph instance
  graph = ForceGraph()(container)
    .graphData({ nodes, links })
    .backgroundColor(CONFIG.colors.background)
    .nodeId('id')
    .nodeVal(node => {
      const metrics = nodeMetrics.get(node.id);
      const weight = metrics ? metrics.totalWeight : 1;
      return CONFIG.nodeSize.scale(weight, maxWeight) ** 2; // ForceGraph uses area, not radius
    })
    .nodeColor(node => {
      // Highlight search matches
      if (highlightNodes.size > 0 && !highlightNodes.has(node.id)) {
        return node.testament === 'NT' ? 'rgba(250, 204, 21, 0.2)' : 'rgba(96, 165, 250, 0.2)';
      }
      // Highlight on hover
      if (hoverNode && hoverNode !== node.id) {
        // Check if connected to hover node
        const isConnected = graphData.chapters.links.some(l => 
          (l.source === hoverNode || l.source.id === hoverNode) && (l.target === node.id || l.target.id === node.id) ||
          (l.target === hoverNode || l.target.id === hoverNode) && (l.source === node.id || l.source.id === node.id)
        );
        if (!isConnected) {
          return node.testament === 'NT' ? 'rgba(250, 204, 21, 0.15)' : 'rgba(96, 165, 250, 0.15)';
        }
      }
      return node.testament === 'NT' ? CONFIG.colors.NT : CONFIG.colors.OT;
    })
    .nodeLabel(null) // We'll use custom tooltip
    .nodeCanvasObjectMode(() => 'after')
    .nodeCanvasObject((node, ctx, globalScale) => {
      // Draw label for larger nodes or when zoomed in
      const metrics = nodeMetrics.get(node.id);
      const weight = metrics ? metrics.totalWeight : 1;
      const radius = CONFIG.nodeSize.scale(weight, maxWeight);
      
      // Only show labels when zoomed in enough or for very large nodes
      if (globalScale < 1.5 && radius < 12) return;
      
      const fontSize = Math.max(10 / globalScale, 2);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      
      // Truncate label if needed
      let label = node.id;
      if (globalScale < 2) {
        // Show abbreviated label
        label = node.id.replace(/(\d)\s/, '$1 ').split(' ').map((part, i) => 
          i === 0 ? part.substring(0, 3) : part
        ).join(' ');
      }
      
      ctx.fillText(label, node.x, node.y + radius + fontSize);
    })
    .linkSource('source')
    .linkTarget('target')
    .linkWidth(link => CONFIG.link.scale(link.weight, maxLinkWeight))
    .linkColor(link => {
      // Highlight links connected to hovered node
      if (hoverNode) {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        if (sourceId === hoverNode || targetId === hoverNode) {
          return CONFIG.colors.linkHighlight;
        }
        return 'rgba(71, 85, 105, 0.1)';
      }
      return CONFIG.colors.link;
    })
    .linkDirectionalParticles(link => {
      // Show particles on highlighted links
      if (hoverNode) {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        if (sourceId === hoverNode || targetId === hoverNode) {
          return 2;
        }
      }
      return 0;
    })
    .linkDirectionalParticleWidth(2)
    .linkDirectionalParticleColor(() => CONFIG.colors.linkHighlight)
    .d3AlphaDecay(0.02)
    .d3VelocityDecay(0.3)
    .d3Force('charge', d3.forceManyBody().strength(CONFIG.physics.chapters.charge))
    .d3Force('link', d3.forceLink().distance(CONFIG.physics.chapters.linkDistance))
    .d3Force('center', d3.forceCenter().strength(CONFIG.physics.chapters.centerStrength))
    .onNodeHover(handleNodeHover)
    .onNodeClick(handleNodeClick)
    .onBackgroundClick(handleBackgroundClick)
    .warmupTicks(100)
    .cooldownTicks(200)
    .onEngineStop(() => {
      hideLoading();
    });
  
  // Update stats
  updateStats(nodes, links);
}

function getFilteredChapterData() {
  const testamentFilter = elements.testamentFilter()?.value || 'all';
  const weightThreshold = parseInt(elements.weightThreshold()?.value || '1');
  const searchTerm = (elements.searchInput()?.value || '').toLowerCase();
  
  // Filter nodes by testament
  let nodes = graphData.chapters.nodes;
  if (testamentFilter !== 'all') {
    nodes = nodes.filter(n => n.testament === testamentFilter);
  }
  
  const nodeIds = new Set(nodes.map(n => n.id));
  
  // Filter links by weight threshold and node visibility
  let links = graphData.chapters.links.filter(l => 
    l.weight >= weightThreshold && 
    nodeIds.has(l.source) && 
    nodeIds.has(l.target)
  );
  
  // Update highlight nodes based on search
  highlightNodes.clear();
  if (searchTerm) {
    for (const node of nodes) {
      if (node.id.toLowerCase().includes(searchTerm) || 
          node.book.toLowerCase().includes(searchTerm)) {
        highlightNodes.add(node.id);
      }
    }
  }
  
  // Deep copy nodes to avoid mutation issues
  nodes = nodes.map(n => ({ ...n }));
  links = links.map(l => ({ ...l }));
  
  return { nodes, links };
}

function getVerseData(chapterId) {
  const verseDetails = graphData.verse_details[chapterId];
  if (!verseDetails) {
    return { nodes: [], links: [] };
  }
  
  // Build a set of valid node IDs
  const nodeIds = new Set(verseDetails.nodes.map(n => n.id));
  
  // Create nodes with proper structure
  const nodes = verseDetails.nodes.map(n => ({
    id: n.id,
    label: n.label,
    verse: n.verse,
    isExternal: n.external || false,
    chapter: n.external ? (n.label ? n.label.replace(/:\d+$/, '') : 'External') : chapterId,
    testament: chapterId.match(/^(Matthew|Mark|Luke|John|Acts|Romans|1 Corinthians|2 Corinthians|Galatians|Ephesians|Philippians|Colossians|1 Thessalonians|2 Thessalonians|1 Timothy|2 Timothy|Titus|Philemon|Hebrews|James|1 Peter|2 Peter|1 John|2 John|3 John|Jude|Revelation)/) ? 'NT' : 'OT'
  }));
  
  // Filter links to only include those with valid node IDs on both ends
  const links = verseDetails.links
    .filter(l => nodeIds.has(l.source) && nodeIds.has(l.target))
    .map(l => ({
      source: l.source,
      target: l.target,
      targetChapter: l.target_chapter,
      weight: 1
    }));
  
  return { nodes, links };
}

function updateStats(nodes, links) {
  const statsEl = elements.stats;
  if (statsEl.nodes()) {
    statsEl.nodes().textContent = nodes.length.toLocaleString();
  }
  if (statsEl.links()) {
    statsEl.links().textContent = links.length.toLocaleString();
  }
  
  if (currentView === 'chapters') {
    // Update labels
    const label1 = elements.statLabel1();
    const label2 = elements.statLabel2();
    if (label1) label1.textContent = 'NT:';
    if (label2) label2.textContent = 'OT:';
    
    const ntCount = nodes.filter(n => n.testament === 'NT').length;
    const otCount = nodes.filter(n => n.testament === 'OT').length;
    
    if (statsEl.nt()) statsEl.nt().textContent = ntCount.toLocaleString();
    if (statsEl.ot()) statsEl.ot().textContent = otCount.toLocaleString();
    
    // Update legend
    const legend = elements.legendContent();
    if (legend) {
      legend.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-yellow-400"></span>
          <span class="text-slate-300">New Testament</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-blue-400"></span>
          <span class="text-slate-300">Old Testament</span>
        </div>
        <div class="flex items-center gap-2 pt-2 border-t border-slate-700">
          <span class="w-6 h-0.5 bg-slate-500"></span>
          <span class="text-slate-400 text-xs">Link thickness = connection strength</span>
        </div>
      `;
    }
  } else {
    // Update labels for verse view
    const label1 = elements.statLabel1();
    const label2 = elements.statLabel2();
    if (label1) label1.textContent = 'Internal:';
    if (label2) label2.textContent = 'External:';
    
    // Verse view - show internal vs external
    const internalCount = nodes.filter(n => !n.isExternal).length;
    const externalCount = nodes.filter(n => n.isExternal).length;
    
    if (statsEl.nt()) statsEl.nt().textContent = internalCount.toLocaleString();
    if (statsEl.ot()) statsEl.ot().textContent = externalCount.toLocaleString();
    
    // Update legend for verse view
    const legend = elements.legendContent();
    if (legend) {
      legend.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-slate-400"></span>
          <span class="text-slate-300">Verses in this chapter</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-slate-600"></span>
          <span class="text-slate-300">External references</span>
        </div>
        <div class="flex items-center gap-2 pt-2 border-t border-slate-700">
          <span class="text-slate-400 text-xs">Click background to go back</span>
        </div>
      `;
    }
  }
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

function handleNodeHover(node) {
  const tooltip = elements.tooltip();
  if (!tooltip) return;
  
  if (node) {
    hoverNode = node.id;
    
    // Get node metrics
    const metrics = nodeMetrics.get(node.id);
    
    // Build tooltip content
    let html = `<h3>${node.id}</h3>`;
    
    if (currentView === 'chapters' && metrics) {
      html += `
        <div class="stat">
          <span class="stat-label">Connections</span>
          <span class="stat-value">${metrics.degree.toLocaleString()}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Total References</span>
          <span class="stat-value">${metrics.totalWeight.toLocaleString()}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Testament</span>
          <span class="stat-value">${node.testament === 'NT' ? 'New Testament' : 'Old Testament'}</span>
        </div>
        <div class="mt-2 pt-2 border-t border-slate-700 text-xs text-slate-400">
          Click to explore verse connections
        </div>
      `;
    } else if (currentView === 'verses') {
      html += `
        <div class="stat">
          <span class="stat-label">Verse</span>
          <span class="stat-value">${node.label || node.id}</span>
        </div>
        ${node.isExternal ? '<div class="text-xs text-slate-400 mt-1">External reference</div>' : ''}
      `;
    }
    
    tooltip.innerHTML = html;
    tooltip.classList.remove('hidden');
    
    // Trigger re-render for highlighting
    if (graph) graph.nodeColor(graph.nodeColor());
    if (graph) graph.linkColor(graph.linkColor());
  } else {
    hoverNode = null;
    tooltip.classList.add('hidden');
    
    // Trigger re-render to remove highlighting
    if (graph) graph.nodeColor(graph.nodeColor());
    if (graph) graph.linkColor(graph.linkColor());
  }
}

function handleNodeClick(node) {
  if (!node) return;
  
  if (currentView === 'chapters') {
    // Drill down to verse view
    expandedChapter = node.id;
    currentView = 'verses';
    
    // Update UI
    const currentViewEl = elements.currentView();
    if (currentViewEl) currentViewEl.textContent = node.id;
    
    const backBtn = elements.backBtn();
    if (backBtn) backBtn.classList.remove('hidden');
    
    // Load verse data
    const { nodes, links } = getVerseData(node.id);
    
    if (nodes.length === 0) {
      // No verse data available, show message
      alert(`No verse-level data available for ${node.id}`);
      currentView = 'chapters';
      expandedChapter = null;
      if (backBtn) backBtn.classList.add('hidden');
      if (currentViewEl) currentViewEl.textContent = 'All Chapters';
      return;
    }
    
    // Determine if this is an NT or OT chapter for coloring internal verses
    const isNT = node.testament === 'NT';
    const internalColor = isNT ? CONFIG.colors.NT : CONFIG.colors.OT;
    
    // Update graph with verse data
    graph
      .d3Force('charge', d3.forceManyBody().strength(CONFIG.physics.verses.charge))
      .d3Force('link', d3.forceLink().distance(CONFIG.physics.verses.linkDistance))
      .d3Force('center', d3.forceCenter().strength(CONFIG.physics.verses.centerStrength))
      .nodeVal(n => n.isExternal ? 5 : 10)
      .nodeColor(n => {
        if (n.isExternal) return CONFIG.colors.external;
        return internalColor;
      })
      .nodeCanvasObject((n, ctx, globalScale) => {
        // Draw labels for verse nodes
        if (globalScale < 2) return;
        
        const fontSize = Math.max(8 / globalScale, 2);
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = n.isExternal ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.9)';
        
        // Show just the verse number for internal, full ref for external
        const label = n.isExternal ? (n.label || n.id) : `v${n.verse || ''}`;
        const radius = n.isExternal ? 3 : 5;
        ctx.fillText(label, n.x, n.y + radius + fontSize);
      })
      .linkWidth(0.8)
      .linkColor(l => {
        // Color links going to external chapters differently
        const targetNode = nodes.find(n => n.id === (typeof l.target === 'object' ? l.target.id : l.target));
        if (targetNode && targetNode.isExternal) {
          return 'rgba(100, 116, 139, 0.4)';
        }
        return CONFIG.colors.link;
      })
      .graphData({ nodes, links });
    
    updateStats(nodes, links);
    
    // Zoom to fit
    setTimeout(() => graph.zoomToFit(400, 50), 300);
  }
}

function handleBackgroundClick() {
  if (currentView === 'verses') {
    goBackToChapters();
  }
}

function goBackToChapters() {
  currentView = 'chapters';
  expandedChapter = null;
  
  // Update UI
  const currentViewEl = elements.currentView();
  if (currentViewEl) currentViewEl.textContent = 'All Chapters';
  
  const backBtn = elements.backBtn();
  if (backBtn) backBtn.classList.add('hidden');
  
  // Get max weights for scaling
  const maxWeight = Math.max(...Array.from(nodeMetrics.values()).map(m => m.totalWeight));
  const maxLinkWeight = Math.max(...graphData.chapters.links.map(l => l.weight));
  
  // Reload chapter data
  const { nodes, links } = getFilteredChapterData();
  
  graph
    .d3Force('charge', d3.forceManyBody().strength(CONFIG.physics.chapters.charge))
    .d3Force('link', d3.forceLink().distance(CONFIG.physics.chapters.linkDistance))
    .d3Force('center', d3.forceCenter().strength(CONFIG.physics.chapters.centerStrength))
    .nodeVal(node => {
      const metrics = nodeMetrics.get(node.id);
      const weight = metrics ? metrics.totalWeight : 1;
      return CONFIG.nodeSize.scale(weight, maxWeight) ** 2;
    })
    .nodeColor(node => {
      if (highlightNodes.size > 0 && !highlightNodes.has(node.id)) {
        return node.testament === 'NT' ? 'rgba(250, 204, 21, 0.2)' : 'rgba(96, 165, 250, 0.2)';
      }
      return node.testament === 'NT' ? CONFIG.colors.NT : CONFIG.colors.OT;
    })
    .nodeCanvasObject((node, ctx, globalScale) => {
      // Draw label for larger nodes or when zoomed in
      const metrics = nodeMetrics.get(node.id);
      const weight = metrics ? metrics.totalWeight : 1;
      const radius = CONFIG.nodeSize.scale(weight, maxWeight);
      
      // Only show labels when zoomed in enough or for very large nodes
      if (globalScale < 1.5 && radius < 12) return;
      
      const fontSize = Math.max(10 / globalScale, 2);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      
      // Truncate label if needed
      let label = node.id;
      if (globalScale < 2) {
        label = node.id.replace(/(\d)\s/, '$1 ').split(' ').map((part, i) => 
          i === 0 ? part.substring(0, 3) : part
        ).join(' ');
      }
      
      ctx.fillText(label, node.x, node.y + radius + fontSize);
    })
    .linkWidth(link => CONFIG.link.scale(link.weight, maxLinkWeight))
    .linkColor(() => CONFIG.colors.link)
    .graphData({ nodes, links });
  
  updateStats(nodes, links);
  
  // Zoom to fit
  setTimeout(() => graph.zoomToFit(400, 50), 300);
}

function handleSearch() {
  if (currentView !== 'chapters') return;
  
  const { nodes, links } = getFilteredChapterData();
  graph.graphData({ nodes, links });
  updateStats(nodes, links);
  
  // If search has results, zoom to first match
  if (highlightNodes.size > 0) {
    const firstMatch = graphData.chapters.nodes.find(n => highlightNodes.has(n.id));
    if (firstMatch && graph) {
      // Find the node in current graph data
      const graphNodes = graph.graphData().nodes;
      const matchNode = graphNodes.find(n => n.id === firstMatch.id);
      if (matchNode) {
        graph.centerAt(matchNode.x, matchNode.y, 1000);
        graph.zoom(3, 1000);
      }
    }
  }
}

function handleFilterChange() {
  if (currentView !== 'chapters') return;
  
  const { nodes, links } = getFilteredChapterData();
  graph.graphData({ nodes, links });
  updateStats(nodes, links);
  
  // Zoom to fit new data
  setTimeout(() => graph.zoomToFit(400, 50), 300);
}

function handleWeightChange() {
  const value = elements.weightThreshold()?.value || '1';
  const valueEl = elements.weightValue();
  if (valueEl) valueEl.textContent = value;
  
  handleFilterChange();
}

// ============================================================================
// TOOLTIP POSITIONING
// ============================================================================

function updateTooltipPosition(event) {
  const tooltip = elements.tooltip();
  if (!tooltip || tooltip.classList.contains('hidden')) return;
  
  const padding = 15;
  let x = event.clientX + padding;
  let y = event.clientY + padding;
  
  // Keep tooltip on screen
  const rect = tooltip.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) {
    x = event.clientX - rect.width - padding;
  }
  if (y + rect.height > window.innerHeight) {
    y = event.clientY - rect.height - padding;
  }
  
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

async function init() {
  // Set up event listeners
  elements.dismissInstructions()?.addEventListener('click', () => {
    const instructions = elements.instructions();
    if (instructions) {
      instructions.style.opacity = '0';
      setTimeout(() => instructions.remove(), 300);
    }
    // Store preference
    localStorage.setItem('scripture-graph-instructions-seen', 'true');
  });
  
  // Check if instructions already seen
  if (localStorage.getItem('scripture-graph-instructions-seen')) {
    elements.instructions()?.remove();
  }
  
  elements.searchInput()?.addEventListener('input', debounce(handleSearch, 300));
  elements.testamentFilter()?.addEventListener('change', handleFilterChange);
  elements.weightThreshold()?.addEventListener('input', handleWeightChange);
  elements.backBtn()?.addEventListener('click', goBackToChapters);
  
  // Track mouse for tooltip positioning
  document.addEventListener('mousemove', updateTooltipPosition);
  
  // Handle window resize
  window.addEventListener('resize', () => {
    if (graph) {
      graph.width(window.innerWidth);
      graph.height(window.innerHeight);
    }
  });
  
  // Load data and initialize graph
  const loaded = await loadData();
  if (loaded) {
    initGraph();
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(null, args), delay);
  };
}

// ============================================================================
// START
// ============================================================================

document.addEventListener('DOMContentLoaded', init);
