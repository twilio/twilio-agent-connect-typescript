// Keep telemetry off for the whole suite so tests never construct a real
// Segment client or send fixture events. Tests that exercise the analytics
// module clear this and mock the client themselves.
process.env.TAC_ANALYTICS_DISABLED = 'true';
