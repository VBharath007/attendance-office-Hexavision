// ── AI ROUTES ─────────────────────────────────────────────────────
const express = require('express');
const aiRouter = express.Router();
const { authenticate } = require('../middleware/auth');
const aiService = require('../services/aiService');

aiRouter.post('/chat', authenticate, async (req, res) => {
  try {
    const { message, conversation_history = [] } = req.body;
    if (!message?.trim()) return res.status(400).json({ success: false, message: 'Message required' });
    const result = await aiService.chat(req.user.uid, req.user.role, message, conversation_history);
    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, message: 'AI error' }); }
});

aiRouter.get('/monthly-report', authenticate, async (req, res) => {
  try {
    const employeeId = req.user.role === 'admin' ? req.query.employee_id : req.user.uid;
    if (!employeeId) return res.status(400).json({ success: false, message: 'employee_id required' });
    const report = await aiService.generateMonthlyReport(employeeId);
    res.json({ success: true, data: { report } });
  } catch (err) { res.status(500).json({ success: false, message: 'AI error' }); }
});

module.exports = aiRouter;
