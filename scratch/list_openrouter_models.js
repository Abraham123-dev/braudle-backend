async function test() {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models');
    const data = await response.json();
    console.log('Sample model format:', JSON.stringify(data.data.slice(0, 3), null, 2));
    
    // Find all models with 'embed' in ID
    const embedModels = data.data.filter(m => m.id.toLowerCase().includes('embed'));
    console.log('\nModels with "embed" in ID:');
    embedModels.forEach(m => console.log(`- ${m.id}`));
  } catch (err) {
    console.error('Error:', err);
  }
}

test();
