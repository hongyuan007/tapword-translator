import * as http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const LOCAL_HOST = '127.0.0.1';

export interface FixtureServer {
    baseUrl: string;
    server: http.Server;
}

/**
 * Start a local HTTP server that serves files from the given fixtures directory.
 *
 * @param fixturesDir - Absolute path to the directory containing fixture HTML files.
 * @returns A handle with the base URL and the underlying server instance.
 */
export async function createFixtureServer(fixturesDir: string): Promise<FixtureServer> {
    return new Promise<FixtureServer>((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            const requestPath = req.url === '/' ? '' : req.url!;
            const fixturesRoot = path.resolve(fixturesDir);
            const resolvedPath = path.resolve(fixturesDir, '.' + requestPath);
            // Guard against path traversal: ensure the resolved path stays within fixturesDir
            if (!resolvedPath.startsWith(fixturesRoot + path.sep) && resolvedPath !== fixturesRoot) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }
            const filePath = resolvedPath;

            try {
                const content = await fs.readFile(filePath);
                const ext = path.extname(filePath).toLowerCase();
                const contentType =
                    ext === '.html' ? 'text/html' :
                    ext === '.css'  ? 'text/css' :
                    ext === '.js'   ? 'application/javascript' :
                    'application/octet-stream';

                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content);
            } catch {
                res.writeHead(404);
                res.end('Not Found');
            }
        });

        server.listen(0, LOCAL_HOST, () => {
            const address = server.address();
            if (typeof address === 'object' && address) {
                resolve({
                    baseUrl: `http://${LOCAL_HOST}:${address.port}`,
                    server,
                });
            } else {
                reject(new Error('Failed to get server address'));
            }
        });
    });
}

/**
 * Close a fixture server instance.
 */
export async function closeFixtureServer(server: FixtureServer): Promise<void> {
    return new Promise<void>((resolve) => {
        server.server.close(() => resolve());
    });
}
