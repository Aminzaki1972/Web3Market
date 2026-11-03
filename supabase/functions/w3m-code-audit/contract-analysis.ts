export type ContractSourceFile = { path: string; content: string };
export type ContractFinding = { severity: "high" | "medium" | "low" | "info"; category: "smart_contract_security"; title: string; status: "needs_verification"; file_path: string; line_start: number; line_end: number; evidence: string; description: string; recommendation: string; confidence: number };
type Rule = { pattern: RegExp; severity: ContractFinding["severity"]; title: string; description: string; recommendation: string; confidence: number };
const RULES: Rule[] = [
{pattern:/\btx\s*\.\s*origin\b/,severity:"high",title:"tx.origin used in contract logic",description:"tx.origin appears in this line. Using the transaction origin for authorization can allow phishing-style call-chain abuse; review the surrounding condition.",recommendation:"Use explicit role/ownership checks based on msg.sender and a well-reviewed access-control pattern.",confidence:62},
{pattern:/\.\s*delegatecall\s*\(/,severity:"high",title:"Low-level delegatecall requires review",description:"delegatecall executes code in the caller's storage context. An untrusted target or unsafe storage layout can lead to contract compromise.",recommendation:"Constrain targets to trusted implementations; validate upgrade authorization, storage compatibility and initialization paths.",confidence:60},
{pattern:/\bselfdestruct\s*\(/,severity:"high",title:"selfdestruct opcode usage",description:"The source uses selfdestruct. Its behavior and risk depend on compiler/EVM version and architecture.",recommendation:"Remove unless required; document exact EVM semantics and restrict the path with authorization and tests.",confidence:60},
{pattern:/\.\s*call\s*\{[^}]*\bvalue\s*:/,severity:"medium",title:"Native-asset low-level call",description:"A low-level call transfers native assets. Reentrancy, return-value handling and state-update ordering need review.",recommendation:"Check the call result, apply checks-effects-interactions or a suitable guard, and test adversarial receivers.",confidence:58},
{pattern:/\bunchecked\s*\{/,severity:"medium",title:"Unchecked arithmetic block",description:"An unchecked block disables Solidity overflow/underflow checks for its contents.",recommendation:"Verify bounds and invariants for every operation and add boundary tests.",confidence:58},
{pattern:/\bblock\s*\.\s*timestamp\b/,severity:"low",title:"Block timestamp dependency",description:"The code reads block.timestamp. It should not be treated as precise time or secure randomness.",recommendation:"Do not use timestamps for randomness or precision-sensitive settlement; test boundary behavior.",confidence:55},
{pattern:/\bassembly\s*\{/,severity:"info",title:"Inline assembly requires manual review",description:"Inline assembly bypasses some Solidity-level safety checks and deserves focused review.",recommendation:"Keep assembly minimal, document memory/storage assumptions, and test pointer arithmetic and encoding boundaries.",confidence:52}
];
export function analyzeSmartContracts(files: ContractSourceFile[]): ContractFinding[] {
 const findings: ContractFinding[]=[]; const seen=new Set<string>();
 for(const file of files){if(!/\.sol$/i.test(file.path))continue;const lines=String(file.content||"").split(/\r?\n/);
  for(let i=0;i<lines.length;i++){const line=lines[i],trimmed=line.trim();if(!trimmed||trimmed.startsWith("//")||trimmed.startsWith("*"))continue;
   for(const rule of RULES){if(!rule.pattern.test(line))continue;const key=file.path+"|"+(i+1)+"|"+rule.title;if(seen.has(key))continue;seen.add(key);findings.push({severity:rule.severity,category:"smart_contract_security",title:rule.title,status:"needs_verification",file_path:file.path,line_start:i+1,line_end:i+1,evidence:trimmed.slice(0,500),description:rule.description,recommendation:rule.recommendation,confidence:rule.confidence});}
  }
 }
 return findings.slice(0,40);
}
