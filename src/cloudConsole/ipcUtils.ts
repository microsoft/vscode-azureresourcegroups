import * as http from 'http';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJSON<T>(req: http.IncomingMessage): Promise<any> {
    return new Promise<T>((resolve, reject) => {
        const chunks: string[] = [];
        req.setEncoding('utf8');
        req.on('data', (d: string) => chunks.push(d));
        req.on('error', (err: Error) => reject(err));
        req.on('end', () => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const data = JSON.parse(chunks.join(''));
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            resolve(data);
        });
    });
}

export async function sendData(socketPath: string, data: string): Promise<http.IncomingMessage> {
    return new Promise<http.IncomingMessage>((resolve, reject) => {
        const opts: http.RequestOptions = {
            socketPath,
            path: '/',
            method: 'POST'
        };

        const req = http.request(opts, res => resolve(res));
        req.on('error', (err: Error) => reject(err));
        req.write(data);
        req.end();
    });
}
