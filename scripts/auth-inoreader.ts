import * as readline from 'readline';
import * as http from 'http';
import * as url from 'url';
import dotenv from 'dotenv';

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
        resolve(answer.trim());
    });
  });
};

const getRequiredInput = async (prompt: string, envValue?: string): Promise<string> => {
    if (envValue && envValue.trim().length > 0) {
        console.log(`Using value from env for: ${prompt.split('(')[0].trim()}`);
        return envValue;
    }
    
    let value = '';
    while (!value) {
        value = await question(prompt);
        if (!value) {
            console.log('Value is required. Please try again.');
        }
    }
    return value;
};

async function main() {
  console.log('=== Inoreader OAuth Setup ===\n');

  const clientId = await getRequiredInput('Enter your Inoreader App ID (Client ID): ', process.env.INOREADER_CLIENT_ID);
  const clientSecret = await getRequiredInput('Enter your Inoreader App Key (Client Secret): ', process.env.INOREADER_CLIENT_SECRET);

  const DEFAULT_REDIRECT_URI = 'http://localhost:3002/inoreader/oauth/callback';
  const redirectUri = await question(`Enter your Redirect URI [${DEFAULT_REDIRECT_URI}]: `) || DEFAULT_REDIRECT_URI;
  
  // Parse the redirect URI to get port and path
  const parsedUri = new URL(redirectUri);
  const port = parseInt(parsedUri.port || '80');
  const pathname = parsedUri.pathname;

  console.log(`\nAttempting to start local server on port ${port} to capture callback...`);

  let server: http.Server | undefined;
  
  // Create a promise that resolves when the code is received via the server
  // OR if the server fails to start, we fall back to manual entry.
  const codePromise = new Promise<string>((resolve, reject) => {
      const httpServer = http.createServer(async (req, res) => {
          try {
              const reqUrl = url.parse(req.url || '', true);
              // Simple pathname matching to handle both encoded and decoded cases
              const reqPath = reqUrl.pathname || '/';
              
              if (reqPath === pathname || reqPath === pathname + '/') {
                  const code = reqUrl.query.code as string;
                  if (code) {
                      res.writeHead(200, { 'Content-Type': 'text/html' });
                      res.end('<h1>Authentication successful!</h1><p>You can close this window and return to the terminal.</p>');
                      resolve(code);
                  } else {
                      res.writeHead(400);
                      res.end('No code found in request');
                  }
              } else {
                  // Ignore favicon.ico etc.
                  if (reqPath !== '/favicon.ico') {
                     console.log(`Received request for unknown path: ${reqPath} (Expected: ${pathname})`);
                  }
                  res.writeHead(404);
                  res.end('Not found');
              }
          } catch (e) {
              console.error(e);
              res.writeHead(500);
              res.end('Internal Server Error');
          }
      });
      
      server = httpServer;
      
      httpServer.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
              console.warn(`⚠️  Port ${port} is already in use.`);
              console.warn('You will need to copy the code manually from the browser URL bar after redirection.');
              resolve(''); // Resolve empty to trigger manual fallback
          } else {
              reject(err);
          }
      });

      httpServer.listen(port, () => {
          console.log(`✅ Local server listening on http://localhost:${port}${pathname}`);
      });
  });

  const state = Math.random().toString(36).substring(7);
  const scope = 'read'; 
  
  const authUrl = `https://www.inoreader.com/oauth2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}`;

  console.log('\n1. Visit the following URL to authorize the app:');
  console.log(authUrl);
  
  // Wait for code from server OR fallback
  let code = await codePromise;
  
  if (server) {
      server.close();
      server = undefined;
  }

  if (!code) {
      console.log('\n(Could not capture code automatically)');
      console.log('After authorizing, you will be redirected.');
      console.log('Copy the "code" parameter from the URL in your browser address bar.');
      code = await question('\nEnter the Authorization Code: ');
  } else {
      console.log('\n✅ Captured authorization code automatically!');
  }

  if (!code) {
    console.error('Authorization code is required.');
    process.exit(1);
  }

  // 3. Exchange code for tokens
  console.log('\n3. Exchanging code for tokens...');

  const params = new URLSearchParams({
    code: code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    scope: '', // As per docs example, can be empty or match requested scope
    grant_type: 'authorization_code',
  });

  try {
    const response = await fetch('https://www.inoreader.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const data = await response.json();

    console.log('\n=== SUCCESS! ===\n');
    console.log('Add the following to your .env.local file:');
    console.log(`INOREADER_CLIENT_ID=${clientId}`);
    console.log(`INOREADER_CLIENT_SECRET=${clientSecret}`);
    console.log(`INOREADER_REFRESH_TOKEN=${(data as Record<string, unknown>).refresh_token}`);
    
    console.log('\nAccess Token (valid for ' + (data as Record<string, unknown>).expires_in + 's):');
    console.log((data as Record<string, unknown>).access_token);

  } catch (error) {
    console.error('Error exchanging token:', error);
  } finally {
    rl.close();
  }
}

main();
