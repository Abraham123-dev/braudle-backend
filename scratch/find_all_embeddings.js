async function test() {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models');
    const data = await response.json();
    console.log('Total models:', data.data.length);
    const matches = data.data.filter(m => 
      m.id.includes('embed') || 
      m.id.includes('ada') || 
      m.id.includes('openai')
    );
    console.log('Matching Models:');
    matches.forEach(m => {
      console.log(`- ${m.id} (${m.name})`);
    });
  } catch (err) {
    console.error('Error:', err);
  }
}

test();
