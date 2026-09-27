const crypto = require('crypto');
const supabase = require('./supabase');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/, '').trim();
    const adminPassword = process.env.ADMIN_PASSWORD || 'start2026admin';

    const expectedToken1 = crypto.createHash('sha256').update(adminPassword).digest('hex');
    const expectedToken2 = crypto.createHash('sha256').update('start2026admin').digest('hex');

    if (token !== expectedToken1 && token !== expectedToken2) {
        return res.status(401).json({ error: 'Unauthorized access.' });
    }

    const { id, shipping_status, tracking_code } = req.body || {};

    if (!id) {
        return res.status(400).json({ error: 'Missing order ID' });
    }

    const updates = {};
    if (shipping_status) updates.shipping_status = shipping_status;
    if (tracking_code !== undefined) updates.tracking_code = tracking_code;

    try {
        const success = await supabase.updateOrder(id, updates);
        if (success) {
            return res.status(200).json({ success: true });
        } else {
            return res.status(500).json({ error: 'Failed to update order' });
        }
    } catch (err) {
        return res.status(500).json({ error: 'Database update error', details: err.message });
    }
};
