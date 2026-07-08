// Severity scorer — PLACEHOLDER for slice 1.
//
// The full lexicographic scorer (alert class → population exposed → hazard
// intensity → recency, ADR-0008) lands in slice 3. For a single earthquake
// source, magnitude alone gives a defensible ordering. We still return the
// contributing factors so the ranking stays explainable and the interface
// doesn't change when the real scorer arrives.

export function scoreSeverity(incidentView) {
  const magnitude = incidentView.magnitude;
  // Numeric severity: magnitude when known, else a small floor so unmagnituded
  // events still rank below any real quake but remain visible.
  const severity = typeof magnitude === 'number' ? magnitude : 0;
  return {
    severity,
    factors: {
      basis: 'magnitude-placeholder',
      magnitude: magnitude ?? null,
      alert: incidentView.alert ?? null, // recorded now; scored in slice 3
    },
  };
}
