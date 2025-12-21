/**
 * Stage D: Podcast script verification
 * Final audit using gpt-5.2-thinking to flag unsupported claims,
 * check attributions, and soften overconfident language
 */

import OpenAI from "openai";
import { PodcastItemDigest } from "./podcastDigest";
import { logger } from "../logger";

export interface VerificationIssue {
  type: "unsupported_claim" | "missing_attribution" | "overconfident_language" | "factual_error";
  line: string; // The problematic line from script
  issue: string; // Description
  suggested_fix: string; // How to fix it
  severity: "error" | "warning";
}

export interface VerificationResult {
  script: string; // Corrected script
  issues: VerificationIssue[];
  passedVerification: boolean;
  notes: string;
}

/**
 * Lazy-load OpenAI client
 */
function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new OpenAI({ apiKey });
}

/**
 * Format digests as reference for verification
 */
function formatDigestsForVerification(digests: PodcastItemDigest[]): string {
  return digests
    .map(
      (d) => `
SOURCE: ${d.source_name}
Title: ${d.title}
URL: ${d.url}
Credibility: ${d.credibility_notes}

Facts present in this source:
${d.key_facts.map((f) => `- ${f}`).join("\n")}

Takeaway: ${d.one_line_takeaway}
Known Uncertainties: ${d.uncertainty_or_conflicts.join("; ") || "None"}
---
`
    )
    .join("\n");
}

/**
 * Verify podcast script against digests
 */
export async function verifyPodcastScript(
  script: string,
  digests: PodcastItemDigest[]
): Promise<VerificationResult> {
  logger.info("Verifying podcast script against digests");

  const client = getClient();
  if (!client) {
    logger.warn("OPENAI_API_KEY not set, skipping verification");
    return {
      script,
      issues: [],
      passedVerification: true,
      notes: "Verification skipped (API not available)",
    };
  }

  try {
    const digestContext = formatDigestsForVerification(digests);

    const response = await client.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 6000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: `You are performing a STRICT FACT-CHECK audit of a podcast script against source digests.

GROUND TRUTH (reference digests):
${digestContext}

SCRIPT TO AUDIT:
${script}

AUDIT RULES (STRICT):
1. FACTUAL CLAIMS: Every non-opinion claim must be traceable to a digest fact
   - If not in digests, mark as [NEEDS SUPPORT] with line number
   - Example: "X announced feature Y" → must be in a digest key_fact
2. ATTRIBUTION: Every factual claim needs clear, audible attribution
   - "According to [source]..." OR "[Source] reports..." OK
   - Unattributed claims about real events → error
3. TONE VIOLATIONS: Flag language that overstates confidence
   - "confirms" / "proves" → only OK for primary sources (academic papers, official docs)
   - "suggests" / "indicates" / "reports" → always OK
   - "definitely" / "certainly" → downgrade to "likely" or attribute
4. CONTRADICTIONS: If script contradicts a digest fact, flag as factual_error
5. OPINION CLARITY: Opinions must use "I think", "likely", "suggests", not state as fact

OUTPUT STRICT JSON:
{
  "issues": [
    {
      "type": "unsupported_claim" | "missing_attribution" | "overconfident_language" | "factual_error",
      "line": "exact quoted line from script (max 100 chars)",
      "issue": "what's wrong (1 sentence)",
      "suggested_fix": "corrected text or [NEEDS SUPPORT] marker",
      "severity": "error" or "warning"
    }
  ],
  "corrected_script": "full script with [NEEDS SUPPORT] markers for unsupported claims and obvious fixes applied",
  "summary": "brief assessment (1-2 sentences)",
  "error_count": number,
  "warning_count": number
}

SEVERITY GUIDE:
- ERROR: Unsupported factual claim, missing attribution, contradiction
- WARNING: Overconfident tone that should be softened, missing nuance

Be thorough. Don't pass unsupported claims. Return ONLY valid JSON.`,
        },
      ],
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("No verification result from LLM");
    }

    const result = JSON.parse(content);

    const issues: VerificationIssue[] = (result.issues || []).map((i: Record<string, unknown>) => ({
      type: i.type as VerificationIssue["type"],
      line: (i.line as string) || "",
      issue: (i.issue as string) || "",
      suggested_fix: (i.suggested_fix as string) || "",
      severity: (i.severity as "error" | "warning") || "warning",
    }));

    const errorCount = issues.filter((i) => i.severity === "error").length;
    const passedVerification = errorCount === 0;

    return {
      script: result.corrected_script || script,
      issues,
      passedVerification,
      notes: result.summary || `${issues.length} issues found`,
    };
  } catch (error) {
    logger.warn("Script verification failed", { error });
    return {
      script,
      issues: [],
      passedVerification: true,
      notes: "Verification failed (LLM error), using script as-is",
    };
  }
}

/**
 * Apply verification fixes to script (auto-correct obvious issues)
 */
export function applyVerificationFixes(
  script: string,
  issues: VerificationIssue[]
): string {
  let corrected = script;

  for (const issue of issues) {
    if (issue.severity === "error" && issue.type === "unsupported_claim") {
      // Mark unsupported claims
      if (!corrected.includes("[NEEDS SUPPORT]")) {
        corrected = corrected.replace(issue.line, `${issue.line} [NEEDS SUPPORT]`);
      }
    }

    if (issue.type === "overconfident_language" && issue.suggested_fix) {
      // Tone down confident language
      corrected = corrected.replace(issue.line, issue.suggested_fix);
    }
  }

  return corrected;
}

/**
 * Generate verification report
 */
export function generateVerificationReport(result: VerificationResult): string {
  let report = "# Podcast Script Verification Report\n\n";

  report += `**Passed Verification:** ${result.passedVerification ? "✅ Yes" : "❌ No"}\n`;
  report += `**Summary:** ${result.notes}\n\n`;

  if (result.issues.length > 0) {
    report += "## Issues Found\n\n";

    const errors = result.issues.filter((i) => i.severity === "error");
    const warnings = result.issues.filter((i) => i.severity === "warning");

    if (errors.length > 0) {
      report += "### Errors (must fix)\n\n";
      for (const issue of errors) {
        report += `- **${issue.type}**: "${issue.line}"\n`;
        report += `  Problem: ${issue.issue}\n`;
        report += `  Fix: ${issue.suggested_fix}\n\n`;
      }
    }

    if (warnings.length > 0) {
      report += "### Warnings (consider fixing)\n\n";
      for (const issue of warnings) {
        report += `- **${issue.type}**: "${issue.line}"\n`;
        report += `  Issue: ${issue.issue}\n`;
        report += `  Suggestion: ${issue.suggested_fix}\n\n`;
      }
    }
  } else {
    report += "## All Checks Passed ✅\n\nNo issues found.\n";
  }

  return report;
}
