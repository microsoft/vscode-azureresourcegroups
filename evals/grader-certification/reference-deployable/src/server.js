const http = require('http');

const port = process.env.PORT || 3000;

http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'healthy' }));
        return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('cor-eval-deployable is serving traffic');
}).listen(port);
