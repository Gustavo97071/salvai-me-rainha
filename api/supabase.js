const https = require('https');
const urlModule = require('url');

const supabaseUrl = process.env.SUPABASE_URL || 'https://nubsgeuoepqqkhqbkuqz.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function request(method, path, body = null) {
    return new Promise((resolve) => {
        if (!supabaseUrl || !supabaseKey) {
            console.warn("Supabase credentials not configured. Skipping database operation.");
            return resolve(null);
        }

        const cleanUrl = (supabaseUrl || '').replace(/\/$/, '');
        if (!cleanUrl) return resolve(null);
        const targetUrl = `${cleanUrl}/rest/v1${path}`;
        const parsedUrl = urlModule.parse(targetUrl);
        const dataStr = body ? JSON.stringify(body) : '';

        const headers = {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
        };

        if (body) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(dataStr);
        }

        if (method === 'POST' || method === 'PATCH') {
            headers['Prefer'] = 'return=representation';
        }

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 443,
            path: parsedUrl.path,
            method: method,
            headers: headers
        };

        const req = https.request(options, (res) => {
            let resData = '';
            res.on('data', (c) => resData += c);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(resData ? JSON.parse(resData) : true);
                    } catch (e) {
                        resolve(resData);
                    }
                } else {
                    console.error(`Supabase API error (${method} ${path}): Status ${res.statusCode}. Response: ${resData}`);
                    resolve(null);
                }
            });
        });

        req.on('error', (err) => {
            console.error(`Supabase network error (${method} ${path}):`, err.message);
            resolve(null);
        });

        if (body) {
            req.write(dataStr);
        }
        req.end();
    });
}

module.exports = {
    async insertOrder(order) {
        let res = await request('POST', '/orders', order);
        if (!res && order && order.donor_cpf) {
            const { donor_cpf, ...fallbackOrder } = order;
            res = await request('POST', '/orders', fallbackOrder);
        }
        return res;
    },

    updateOrder(id, updates) {
        return request('PATCH', `/orders?id=eq.${encodeURIComponent(id)}`, updates);
    },

    async updateOrderIfPending(idOrCode, updates) {
        let res = await request('PATCH', `/orders?id=eq.${encodeURIComponent(idOrCode)}&payment_status=eq.pending`, updates);
        if (Array.isArray(res) && res.length > 0) return res;
        res = await request('PATCH', `/orders?tracking_code=eq.${encodeURIComponent(idOrCode)}&payment_status=eq.pending`, updates);
        return res;
    },

    async getAllOrders() {
        let all = [];
        let offset = 0;
        const limit = 1000;
        while (true) {
            const batch = await request('GET', `/orders?order=created_at.desc&limit=${limit}&offset=${offset}`);
            if (!Array.isArray(batch) || batch.length === 0) break;
            all = all.concat(batch);
            if (batch.length < limit) break;
            offset += limit;
        }
        return all;
    },

    getOrders() {
        return this.getAllOrders();
    },

    getOrdersPage(limit, offset) {
        return request('GET', `/orders?order=created_at.desc&limit=${limit}&offset=${offset}`);
    },

    getPendingOrdersByEmail(email) {
        return request('GET', `/orders?donor_email=eq.${encodeURIComponent(email)}&payment_status=eq.pending&order=created_at.desc`);
    },

    getOrderById(id) {
        return request('GET', `/orders?id=eq.${encodeURIComponent(id)}`).then(res => {
            return (Array.isArray(res) && res.length > 0) ? res[0] : null;
        });
    },

    getOrderByTrackingCode(trackingCode) {
        return request('GET', `/orders?tracking_code=eq.${encodeURIComponent(trackingCode)}`).then(res => {
            return (Array.isArray(res) && res.length > 0) ? res[0] : null;
        });
    },

    getRecentPendingOrders(hours = 2, limit = 30) {
        const pastDate = new Date(Date.now() - hours * 3600 * 1000).toISOString();
        return request('GET', `/orders?payment_status=eq.pending&created_at=gte.${encodeURIComponent(pastDate)}&order=created_at.desc&limit=${limit}`);
    },

    searchOrders(term, limit = 200) {
        const cleanTerm = (term || '').replace(/^#/, '').trim();
        if (!cleanTerm) return Promise.resolve([]);
        return request('GET', `/orders?or=(id.ilike.*${encodeURIComponent(cleanTerm)}*,donor_name.ilike.*${encodeURIComponent(cleanTerm)}*,donor_email.ilike.*${encodeURIComponent(cleanTerm)}*,donor_cpf.ilike.*${encodeURIComponent(cleanTerm)}*,tracking_code.ilike.*${encodeURIComponent(cleanTerm)}*)&order=created_at.desc&limit=${limit}`);
    }
};
