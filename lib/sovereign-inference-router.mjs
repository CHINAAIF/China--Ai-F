// Minimal test handler
export async function handleSovereignInference(req, res) {
  res.json({ success: true, message: 'TRUNKIA Inference endpoint is working.', request_id: req._requestId });
}
