// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Prompt-injection defense (§16, §59, §81).
//
// WHY: every uploaded document and retrieved chunk is UNTRUSTED DATA. A blueprint
// may contain "ignore previous instructions / reveal the system prompt". These
// patterns must never become application instructions. Hierarchy enforced:
//   SYSTEM POLICY > APPLICATION POLICY > TASK INSTRUCTIONS > USER REQUEST > DATA
// Retrieved content is evidence, never authority.
// ═══════════════════════════════════════════════════════════════════════════════

/** Patterns that indicate an attempt to override instruction hierarchy. */
const INJECTION_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'ignore-previous', re: /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions?|prompts?|rules?)/i },
  { name: 'reveal-system-prompt', re: /(?:reveal|show|print|repeat|output)\s+(?:the\s+)?(?:system\s+)?(?:prompt|instructions)/i },
  { name: 'role-override', re: /you\s+are\s+now\s+(?:a|an)\s+/i },
  { name: 'execute-command', re: /(?:execute|run)\s+(?:this|the\s+following)\s+(?:command|script|shell)/i },
  { name: 'exfiltrate-secrets', re: /(?:send|reveal|exfiltrate|leak|output)\s+(?:the\s+)?(?:secrets?|api\s*keys?|credentials?|tokens?)/i },
  { name: 'disregard-policy', re: /disregard\s+(?:all\s+)?(?:safety|security|policy|policies)/i },
  { name: 'new-instructions', re: /(?:new|updated)\s+(?:instructions?|directives?)\s*:/i },
  { name: 'developer-mode', re: /(?:developer|dan|god)\s+mode/i },
];

export interface InjectionScan {
  matched: string[]; // pattern names found
  sanitized: string; // input with matched segments neutralized
}

/**
 * Scans untrusted text for injection attempts and neutralizes them.
 * Neutralization = wrapping matched lines in [UNTRUSTED-DATA-REMOVED] markers so
 * the LLM never sees the raw payload, while provenance remains in the logs.
 */
export function scanAndNeutralize(text: string): InjectionScan {
  const matched: string[] = [];
  let sanitized = text;
  for (const { name, re } of INJECTION_PATTERNS) {
    if (re.test(sanitized)) {
      matched.push(name);
      sanitized = sanitized.replace(re, '[untrusted-instruction-removed]');
    }
  }
  return { matched, sanitized };
}

/**
 * Output validation (§81): scans MODEL OUTPUT for leakage of system prompt
 * markers and secrets before it is returned to the user.
 */
const OUTPUT_LEAK_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'system-prompt-leak', re: /SYSTEM\s+POLICY|you\s+are\s+WEDJAT\s+DOMAIN\s+AI\s+system\s+prompt/i },
  { name: 'secret-leak', re: /\b(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/ },
];

export function validateOutput(text: string): { clean: boolean; matched: string[]; sanitized: string } {
  const matched: string[] = [];
  let sanitized = text;
  for (const { name, re } of OUTPUT_LEAK_PATTERNS) {
    if (re.test(sanitized)) {
      matched.push(name);
      sanitized = sanitized.replace(re, '[removed-by-output-validator]');
    }
  }
  return { clean: matched.length === 0, matched, sanitized };
}

/**
 * Evidence wrapper (§13/§16): retrieved chunks are fenced as untrusted data with
 * an explicit instruction that content inside fences is evidence only.
 */
export function fenceEvidence(index: number, meta: string, content: string): string {
  // Strip any pre-existing fences inside the content so nested fencing cannot
  // break out of the evidence boundary.
  const safeContent = content
    .replace(/```/g, '``\u200b`') // zero-width break
    .replace(/<<<EVIDENCE/g, '<<<EVIDEN\u200bCE');
  return `<<<EVIDENCE-S${index} ${meta}>>>\n${safeContent}\n<<<END-EVIDENCE-S${index}>>>`;
}
