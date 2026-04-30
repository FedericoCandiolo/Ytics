// ─── ML Utilities: K-Means & DBSCAN Clustering ──────────────────────────────
// Pure JS implementations — no external dependencies.

// ── Z-score normalization ────────────────────────────────────────────────────
function zScoreNormalize(matrix) {
  const nCols = matrix[0].length;
  const stats = [];
  for (let j = 0; j < nCols; j++) {
    const vals = matrix.map(row => row[j]);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length) || 1;
    stats.push({ mean, std });
  }
  const normalized = matrix.map(row =>
    row.map((v, j) => (v - stats[j].mean) / stats[j].std)
  );
  return { normalized, stats };
}

// ── Euclidean distance ───────────────────────────────────────────────────────
function euclidean(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

// ── K-Means Clustering ──────────────────────────────────────────────────────
// Returns { labels: number[], centroids: number[][], iterations: number }
export function kMeans(matrix, k, { maxIter = 100, seed = 42 } = {}) {
  const n = matrix.length;
  if (n === 0 || k <= 0) return { labels: [], centroids: [], iterations: 0 };
  k = Math.min(k, n);

  const dim = matrix[0].length;

  // Seeded RNG (simple LCG)
  let rngState = seed;
  const rng = () => {
    rngState = (rngState * 1664525 + 1013904223) & 0x7fffffff;
    return rngState / 0x7fffffff;
  };

  // K-Means++ initialization
  const centroids = [matrix[Math.floor(rng() * n)]];
  for (let c = 1; c < k; c++) {
    const dists = matrix.map(p => {
      let minD = Infinity;
      for (const cen of centroids) minD = Math.min(minD, euclidean(p, cen));
      return minD * minD;
    });
    const total = dists.reduce((a, b) => a + b, 0);
    let r = rng() * total, cumSum = 0;
    for (let i = 0; i < n; i++) {
      cumSum += dists[i];
      if (cumSum >= r) { centroids.push(matrix[i]); break; }
    }
    if (centroids.length <= c) centroids.push(matrix[Math.floor(rng() * n)]);
  }

  const labels = new Array(n).fill(0);
  let iter = 0;

  for (; iter < maxIter; iter++) {
    // Assign
    let changed = false;
    for (let i = 0; i < n; i++) {
      let bestK = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = euclidean(matrix[i], centroids[c]);
        if (d < bestD) { bestD = d; bestK = c; }
      }
      if (labels[i] !== bestK) { labels[i] = bestK; changed = true; }
    }
    if (!changed) break;

    // Update centroids
    const sums = Array.from({ length: k }, () => new Array(dim).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const c = labels[i];
      counts[c]++;
      for (let j = 0; j < dim; j++) sums[c][j] += matrix[i][j];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue;
      for (let j = 0; j < dim; j++) centroids[c][j] = sums[c][j] / counts[c];
    }
  }

  return { labels, centroids, iterations: iter };
}

// ── Elbow method: find optimal k ─────────────────────────────────────────────
// Returns { bestK, inertias: [{k, inertia}] }
export function elbowMethod(matrix, maxK = 10, options = {}) {
  maxK = Math.min(maxK, matrix.length);
  const inertias = [];

  for (let k = 1; k <= maxK; k++) {
    const { labels, centroids } = kMeans(matrix, k, options);
    let inertia = 0;
    for (let i = 0; i < matrix.length; i++) {
      inertia += euclidean(matrix[i], centroids[labels[i]]) ** 2;
    }
    inertias.push({ k, inertia });
  }

  // Find elbow: maximum second derivative (biggest rate-of-change drop)
  let bestK = 2;
  let maxDiff = -Infinity;
  for (let i = 1; i < inertias.length - 1; i++) {
    const d2 = inertias[i - 1].inertia - 2 * inertias[i].inertia + inertias[i + 1].inertia;
    if (d2 > maxDiff) { maxDiff = d2; bestK = inertias[i].k; }
  }

  return { bestK, inertias };
}

// ── DBSCAN Clustering ────────────────────────────────────────────────────────
// Returns { labels: number[], nClusters: number }
// label -1 = noise/outlier
export function dbscan(matrix, { epsilon = 0.5, minPoints = 5 } = {}) {
  const n = matrix.length;
  if (n === 0) return { labels: [], nClusters: 0 };

  const labels = new Array(n).fill(-2); // -2 = unvisited
  let clusterId = 0;

  // Pre-compute distance matrix for small datasets, use brute force for larger
  const getNeighbors = (idx) => {
    const neighbors = [];
    for (let j = 0; j < n; j++) {
      if (j === idx) continue;
      if (euclidean(matrix[idx], matrix[j]) <= epsilon) neighbors.push(j);
    }
    return neighbors;
  };

  for (let i = 0; i < n; i++) {
    if (labels[i] !== -2) continue; // already visited

    const neighbors = getNeighbors(i);
    if (neighbors.length < minPoints) {
      labels[i] = -1; // noise
      continue;
    }

    // Start new cluster
    labels[i] = clusterId;
    const queue = [...neighbors];
    const inQueue = new Set(neighbors);

    while (queue.length > 0) {
      const j = queue.shift();
      if (labels[j] === -1) labels[j] = clusterId; // noise becomes border
      if (labels[j] !== -2) continue; // already processed

      labels[j] = clusterId;
      const jNeighbors = getNeighbors(j);
      if (jNeighbors.length >= minPoints) {
        for (const nb of jNeighbors) {
          if (!inQueue.has(nb) && (labels[nb] === -2 || labels[nb] === -1)) {
            queue.push(nb);
            inQueue.add(nb);
          }
        }
      }
    }

    clusterId++;
  }

  return { labels, nClusters: clusterId };
}

// ── Auto-estimate epsilon for DBSCAN ─────────────────────────────────────────
// Uses k-distance graph: sort k-nearest-neighbor distances and find the "knee"
// via max perpendicular distance from the line connecting first and last points
export function estimateEpsilon(matrix, minPoints = 5) {
  const n = matrix.length;
  const k = Math.min(minPoints, n - 1);
  if (k <= 0) return 0.5;

  // Compute k-th nearest neighbor distance for each point
  const kDists = [];
  for (let i = 0; i < n; i++) {
    const dists = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      dists.push(euclidean(matrix[i], matrix[j]));
    }
    dists.sort((a, b) => a - b);
    kDists.push(dists[k - 1] || 0);
  }

  kDists.sort((a, b) => a - b);

  if (kDists.length < 3) return kDists[kDists.length - 1] || 0.5;

  // Kneedle: find point with max perpendicular distance from the line
  // connecting (0, kDists[0]) to (n-1, kDists[n-1])
  // Normalize both axes to [0,1] so slope doesn't bias the result
  const xMax = kDists.length - 1;
  const yMin = kDists[0];
  const yMax = kDists[kDists.length - 1];
  const yRange = yMax - yMin || 1;

  // Line from first to last point in normalized space
  const x1 = 0, y1 = 0;
  const x2 = 1, y2 = 1;
  // Line direction
  const dx = x2 - x1, dy = y2 - y1;
  const lineLen = Math.sqrt(dx * dx + dy * dy);

  let bestIdx = Math.floor(n * 0.9);
  let maxDist = -Infinity;
  for (let i = 0; i < kDists.length; i++) {
    const px = i / xMax;           // normalized x
    const py = (kDists[i] - yMin) / yRange; // normalized y
    // Perpendicular distance from point to line
    const dist = Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / lineLen;
    if (dist > maxDist) { maxDist = dist; bestIdx = i; }
  }

  return kDists[bestIdx] || 0.5;
}

// ── High-level: run clustering on dataset ────────────────────────────────────
// data: array of row objects
// fields: array of field names to use as features
// config: { algorithm: 'kmeans'|'dbscan', k, epsilon, minPoints, autoK, autoEpsilon, columnName }
// Returns: { data: augmented rows, stats: { nClusters, algorithm, ... } }
export function runClustering(data, fields, config) {
  const {
    algorithm = 'kmeans',
    k = 3,
    epsilon,
    minPoints = 5,
    autoK = false,
    autoEpsilon = true,
    columnName = '_cluster',
  } = config;

  if (!data.length || !fields.length) {
    return { data, stats: { error: 'No data or fields selected' } };
  }

  // Build numeric matrix
  const matrix = data.map(row =>
    fields.map(f => {
      const v = +row[f];
      return isNaN(v) ? 0 : v;
    })
  );

  // Normalize
  const { normalized } = zScoreNormalize(matrix);

  let labels, stats;

  if (algorithm === 'dbscan') {
    let eps = autoEpsilon ? estimateEpsilon(normalized, minPoints) : (epsilon ?? 0.5);
    let result = dbscan(normalized, { epsilon: eps, minPoints });

    // Adaptive: if only 1 cluster, progressively reduce epsilon to find structure
    if (autoEpsilon && result.nClusters <= 1) {
      const maxAttempts = 15;
      for (let attempt = 0; attempt < maxAttempts && result.nClusters <= 1; attempt++) {
        eps *= 0.7; // reduce by 30% each step
        if (eps < 1e-6) break;
        result = dbscan(normalized, { epsilon: eps, minPoints });
      }
      // If still 1 cluster, also try reducing minPoints
      if (result.nClusters <= 1 && minPoints > 2) {
        const reducedMinPts = Math.max(2, Math.floor(minPoints / 2));
        eps = estimateEpsilon(normalized, reducedMinPts);
        for (let attempt = 0; attempt < maxAttempts && result.nClusters <= 1; attempt++) {
          eps *= 0.7;
          if (eps < 1e-6) break;
          result = dbscan(normalized, { epsilon: eps, minPoints: reducedMinPts });
        }
      }
    }

    labels = result.labels;
    stats = {
      algorithm: 'DBSCAN',
      nClusters: result.nClusters,
      noiseCount: labels.filter(l => l === -1).length,
      epsilon: eps,
      minPoints,
    };
  } else {
    // K-Means
    let finalK = k;
    let elbowInfo = null;
    if (autoK) {
      const elbow = elbowMethod(normalized, Math.min(10, Math.floor(data.length / 2)));
      finalK = elbow.bestK;
      elbowInfo = elbow.inertias;
    }
    const result = kMeans(normalized, finalK);
    labels = result.labels;
    stats = {
      algorithm: 'K-Means',
      nClusters: finalK,
      iterations: result.iterations,
      elbowInfo,
    };
  }

  // Map labels to readable strings
  const augmented = data.map((row, i) => ({
    ...row,
    [columnName]: labels[i] === -1 ? 'Noise' : `Cluster ${labels[i] + 1}`,
  }));

  return { data: augmented, stats };
}
