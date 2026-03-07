'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const flow = JSON.parse(fs.readFileSync(path.join(__dirname, 'flow.json'), 'utf8'));

function httpsPost(hostname, reqPath, headers, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = https.request({ hostname, path: reqPath, method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        }, res => { let r = ''; res.on('data', d => r += d); res.on('end', () => resolve(JSON.parse(r))); });
        req.on('error', reject); req.write(data); req.end();
    });
}

async function callAI(prompt, model) {
    const useGemini = !!(process.env.GEMINI_API_KEY);
    if (useGemini) {
        const key = process.env.GEMINI_API_KEY;
        const m = model && model.includes('gemini') ? model : 'models/gemini-2.0-flash';
        const res = await httpsPost('generativelanguage.googleapis.com',
            '/v1beta/' + m + ':generateContent?key=' + key, {},
            { contents: [{ parts: [{ text: prompt }] }] });
        return res.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
        const key = process.env.ANTHROPIC_API_KEY;
        const res = await httpsPost('api.anthropic.com', '/v1/messages',
            { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
            { model: 'claude-haiku-4-5-20251001', max_tokens: 4096, messages: [{ role: 'user', content: prompt }] });
        return res.content?.[0]?.text || '';
    }
}

async function fetchUrl(url) {
    return new Promise((resolve) => {
        const mod = url.startsWith('https') ? require('https') : require('http');
        mod.get(url, res => {
            let r = ''; res.on('data', d => r += d); res.on('end', () => resolve(r));
        }).on('error', e => resolve('Error: ' + e.message));
    });
}

async function run() {
    const nodeMap = {};
    for (const n of flow.nodes) nodeMap[n.id] = n;
    // Topological order: input first, then follow connections
    const order = [];
    const visited = new Set();
    const visit = (id) => {
        if (visited.has(id)) return; visited.add(id);
        const incoming = flow.connections.filter(c => c.to === id).map(c => c.from);
        for (const p of incoming) visit(p);
        order.push(id);
    };
    for (const n of flow.nodes) visit(n.id);
    const outputs = {};
    for (const id of order) {
        const node = nodeMap[id];
        const incoming = flow.connections.filter(c => c.to === id);
        const inputText = incoming.length ? (outputs[incoming[0].from] || '') : '';
        if (node.type === 'input') {
            outputs[id] = node.data.prompt || '';
        } else if (node.type === 'agent' || node.type === 'model') {
            const prompt = (node.data.prompt || '{{input}}').replace('{{input}}', inputText);
            console.log('[' + (node.data.label || 'agent') + '] calling AI...');
            outputs[id] = await callAI(prompt, node.data.model);
            console.log('[' + (node.data.label || 'agent') + '] done.');
        } else if (node.type === 'tool' && node.data.tool === 'fetch_url') {
            const url = (node.data.url || inputText).replace('{{input}}', inputText);
            outputs[id] = await fetchUrl(url);
        } else if (node.type === 'output') {
            console.log('\n=== OUTPUT ===\n' + inputText + '\n==============');
            outputs[id] = inputText;
        } else {
            outputs[id] = inputText;
        }
    }
}
run().catch(e => { console.error('Flow error:', e); process.exit(1); });
