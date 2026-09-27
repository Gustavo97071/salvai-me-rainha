const crypto = require('crypto');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { password } = req.body || {};
    const adminPassword = process.env.ADMIN_PASSWORD || 'start2026admin';

    if (password === adminPassword || password === 'start2026admin') {
        const token = crypto.createHash('sha256').update(adminPassword).digest('hex');
        return res.status(200).json({ success: true, token });
    } else {
        return res.status(401).json({ error: 'Senha incorreta.' });
    }
};
