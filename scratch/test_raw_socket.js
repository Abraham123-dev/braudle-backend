import net from 'net';

console.log('Connecting to localhost:6379...');
const client = net.createConnection({ port: 6379, host: '127.0.0.1' }, () => {
  console.log('TCP Connected! Sending raw PING...');
  client.write('PING\r\n');
});

client.on('data', (data) => {
  console.log('Received raw data from server:', JSON.stringify(data.toString()));
  client.end();
});

client.on('end', () => {
  console.log('Disconnected from server');
});

client.on('error', (err) => {
  console.error('Socket error:', err);
});

setTimeout(() => {
  console.log('Timeout after 10s. Closing socket...');
  client.destroy();
  process.exit(1);
}, 10000);
