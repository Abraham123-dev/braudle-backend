async function test() {
  const urls = [
    'https://www.google.com',
    'https://openrouter.ai/api/v1/models',
    'https://api.mistral.ai/v1/models'
  ];

  for (const url of urls) {
    console.log(`\nFetching ${url}...`);
    try {
      const start = Date.now();
      const res = await fetch(url, { method: 'GET' });
      console.log(`Status: ${res.status} (${res.statusText}) in ${Date.now() - start}ms`);
    } catch (err) {
      console.error('Fetch failed:');
      console.error(err);
    }
  }
}

test();
