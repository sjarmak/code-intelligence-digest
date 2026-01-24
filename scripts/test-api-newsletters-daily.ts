/**
 * Test the actual API endpoint to see what it returns
 */

async function testAPI() {
  const url = 'http://localhost:3002/api/items?category=newsletters&period=day';

  console.log('=== TESTING API ENDPOINT ===');
  console.log('');
  console.log(`GET ${url}`);
  console.log('');

  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`❌ API Error: ${response.status} ${response.statusText}`);
      const text = await response.text();
      console.error(text);
      return;
    }

    const data = await response.json();

    console.log(`✅ Response received:`);
    console.log(`  Total items: ${data.totalItems}`);
    console.log(`  Items ranked: ${data.itemsRanked}`);
    console.log(`  Items filtered: ${data.itemsFiltered}`);
    console.log(`  Items returned: ${data.items?.length || 0}`);
    console.log('');

    if (data.items && data.items.length > 0) {
      console.log('First 5 items:');
      data.items.slice(0, 5).forEach((item: any, i: number) => {
        console.log(`  ${i + 1}. ${item.title.substring(0, 60)}...`);
        console.log(`     Score: ${item.finalScore.toFixed(3)} (displays as ${item.finalScore.toFixed(2)})`);
        console.log(`     Source: ${item.sourceTitle}`);
      });
    } else {
      console.log('❌ NO ITEMS RETURNED!');
    }
  } catch (error) {
    console.error('❌ Request failed:', error);
    console.log('');
    console.log('Note: Make sure the dev server is running on port 3002');
  }
}

testAPI();

