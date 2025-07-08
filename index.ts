import { openai } from "@ai-sdk/openai";
import DeepResearch from "@common/ai/agents/DeepResearch";

async function main() {
  try {
    // Initialize the DeepResearch agent with efficient configuration
    const deepResearch = new DeepResearch({
      agentModel: openai("gpt-4o-mini"),
      synthModel: openai("o4-mini"),
      defaultDepth: 2,
      defaultBreadth: 2,
      verbose: true,
    });

    // Define the research topic
    const researchTopic = `What is Longevity Escape Velocity? And how AI can help humans achieve it?`

    // Conduct comprehensive research
    console.log("🚀 Starting deep research...");
    const research = await deepResearch.conductResearch(researchTopic);

    // Generate a comprehensive report
    console.log("📄 Generating research report...");
    const report = await deepResearch.generateReport();

    // Save the report to a file
    const fileName = `report-${new Date().getTime()}.md`;
    await Bun.write(fileName, report);

    console.log("✅ Research completed successfully!");
    console.log(`📁 Report saved to: ${fileName}`);
    console.log(`📊 Research summary:`);
    console.log(
      `   - Total queries processed: ${research.completedQueries.length}`
    );
    console.log(
      `   - Relevant sources found: ${research.searchResults.length}`
    );
    console.log(`   - Learnings extracted: ${research.learnings.length}`);
  } catch (error) {
    console.error("❌ Error during research:", error);
    process.exit(1);
  }
}

// Run the main function
main();
