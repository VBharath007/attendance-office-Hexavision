// ═══════════════════════════════════════════════════════
// AI SERVICE  (Anthropic)
// ═══════════════════════════════════════════════════════
const Anthropic = require('@anthropic-ai/sdk');
const { db } = require('../config/firebase');
const functions = require('firebase-functions');

const anthropic = new Anthropic({
  apiKey: functions.config().anthropic?.key || process.env.ANTHROPIC_API_KEY,
});

const buildContext = async (userId, role) => {
  if (role === 'admin') {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const today = new Date().toISOString().split('T')[0];

    const [attSnap, pendingLeaves, pendingRegs] = await Promise.all([
      db.collection('attendance').where('date', '==', today).get(),
      db.collection('leaves').where('status', '==', 'pending').get(),
      db.collection('employees').where('status', '==', 'pending').get(),
    ]);

    const att = attSnap.docs.map(d => d.data());
    return `Admin Dashboard:
Today (${today}): Present=${att.filter(a => ['present','late'].includes(a.status)).length}, Late=${att.filter(a=>a.status==='late').length}, Appreciated=${att.filter(a=>a.is_appreciated).length}
Pending: ${pendingLeaves.size} leave requests | ${pendingRegs.size} registrations`;
  }

  // Employee context
  const empSnap = await db.collection('employees').doc(userId).get();
  const emp = empSnap.data();
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const summarySnap = await db.collection('monthly_summary').doc(`${userId}_${year}_${month}`).get();
  const s = summarySnap.exists ? summarySnap.data() : {};

  return `Employee: ${emp.full_name} | ${emp.designation}
Month ${month}/${year}: Present=${s.present_days||0}d, Absent=${s.absent_days||0}d, Late=${s.late_days||0}d
Working Hours: ${s.total_working_hours||0}h / ${s.expected_hours||0}h
Appreciation Days: ${s.appreciation_days||0}
Salary: Net=₹${s.net_salary||'N/A'}, Deductions=₹${s.total_deduction||0}
Leave Balance: ${emp.earned_leave_balance||0} days
Office: 9:30–6:30 | Grace: 10:10 | Appreciation: on-time in + checkout ≥7:30PM`;
};

const chat = async (userId, role, userMessage, history = []) => {
  const context = await buildContext(userId, role);
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    system: `You are an HR assistant for an attendance app. Help ${role === 'admin' ? 'admins manage employees' : 'employees understand their attendance and salary'}.
Reply in same language as user (Tamil or English). Be concise and friendly.
Context: ${context}`,
    messages: [...history.slice(-8), { role: 'user', content: userMessage }],
  });
  return {
    message: response.content[0].text,
    updatedHistory: [...history.slice(-8), { role: 'user', content: userMessage }, { role: 'assistant', content: response.content[0].text }],
  };
};

const generateMonthlyReport = async (employeeId) => {
  const context = await buildContext(employeeId, 'employee');
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [{ role: 'user', content: `Generate a brief monthly attendance report (under 150 words). Include: attendance overview, punctuality, appreciation highlights, salary impact.\n\nData:\n${context}` }],
  });
  return response.content[0].text;
};

module.exports = { chat, generateMonthlyReport };
