import net from 'node:net';

function authority(value) {
  if (!value || /[\s/@\\?#]/.test(value)) return null;
  try {
    const u = new URL(`http://${value}`);
    return { host: u.host, name: u.hostname.replace(/^\[|\]$/g, ''), port: u.port };
  } catch { return null; }
}

export function trustedHost(host, server, env = process.env) {
  const target = authority(host);
  if (!target) return false;
  if (net.isIP(target.name) || target.name === 'localhost') return true;
  const configured = [server.publicHost, `${server.publicHost}:${server.port}`,
    ...(env.UI_HOSTS || '').split(',').map((s) => s.trim())];
  return configured.some((value) => {
    const allowed = authority(value);
    return allowed && allowed.name === target.name && (!allowed.port || allowed.port === target.port);
  });
}
