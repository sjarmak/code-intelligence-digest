import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("OPENAI_API_KEY not set");
  process.exit(1);
}

const client = new OpenAI({ apiKey });

async function listModels() {
  try {
    const models = await client.models.list();
    const sortedModels = models.data
      .map(m => m.id)
      .sort()
      .filter(id => id.includes('gpt'));
    
    console.log("Available GPT models:");
    sortedModels.forEach(id => console.log(`  - ${id}`));
  } catch (error) {
    console.error("Error listing models:", error.message);
  }
}

listModels();
