/** Compact MITRE ATT&CK names for hover (not a full STIX catalog). */

export interface MitreHover {
    id: string;
    kind: 'tactic' | 'technique';
    name: string;
    url: string;
}

const TACTICS: Record<string, string> = {
    TA0001: 'Initial Access',
    TA0002: 'Execution',
    TA0003: 'Persistence',
    TA0004: 'Privilege Escalation',
    TA0005: 'Defense Evasion',
    TA0006: 'Credential Access',
    TA0007: 'Discovery',
    TA0008: 'Lateral Movement',
    TA0009: 'Collection',
    TA0010: 'Exfiltration',
    TA0011: 'Command and Control',
    TA0040: 'Impact',
    TA0042: 'Resource Development',
    TA0043: 'Reconnaissance'
};

const TECHNIQUES: Record<string, string> = {
    T1003: 'OS Credential Dumping',
    T1005: 'Data from Local System',
    T1018: 'Remote System Discovery',
    T1021: 'Remote Services',
    T1027: 'Obfuscated Files or Information',
    T1033: 'System Owner/User Discovery',
    T1036: 'Masquerading',
    T1046: 'Network Service Discovery',
    T1047: 'Windows Management Instrumentation',
    T1048: 'Exfiltration Over Alternative Protocol',
    T1053: 'Scheduled Task/Job',
    T1055: 'Process Injection',
    T1057: 'Process Discovery',
    T1059: 'Command and Scripting Interpreter',
    'T1059.001': 'PowerShell',
    'T1059.003': 'Windows Command Shell',
    T1070: 'Indicator Removal',
    T1071: 'Application Layer Protocol',
    T1078: 'Valid Accounts',
    'T1078.004': 'Cloud Accounts',
    T1082: 'System Information Discovery',
    T1087: 'Account Discovery',
    T1098: 'Account Manipulation',
    T1105: 'Ingress Tool Transfer',
    T1110: 'Brute Force',
    'T1110.001': 'Password Guessing',
    'T1110.003': 'Password Spraying',
    T1114: 'Email Collection',
    T1133: 'External Remote Services',
    T1136: 'Create Account',
    T1190: 'Exploit Public-Facing Application',
    T1199: 'Trusted Relationship',
    T1218: 'System Binary Proxy Execution',
    T1485: 'Data Destruction',
    T1486: 'Data Encrypted for Impact',
    T1490: 'Inhibit System Recovery',
    T1518: 'Software Discovery',
    T1543: 'Create or Modify System Process',
    T1547: 'Boot or Logon Autostart Execution',
    T1552: 'Unsecured Credentials',
    T1555: 'Credentials from Password Stores',
    T1556: 'Modify Authentication Process',
    T1558: 'Steal or Forge Kerberos Tickets',
    T1562: 'Impair Defenses',
    T1566: 'Phishing',
    T1567: 'Exfiltration Over Web Service'
};

const TECHNIQUE_RE = /^(T\d{4})(?:\.(\d{3}))?$/i;
const TACTIC_RE = /^(TA\d{4})$/i;

export function lookupMitre(id: string): MitreHover | undefined {
    const tactic = id.trim().toUpperCase().match(TACTIC_RE);
    if (tactic) {
        const key = tactic[1].toUpperCase();
        const name = TACTICS[key];
        if (!name) {
            return undefined;
        }
        return {
            id: key,
            kind: 'tactic',
            name,
            url: `https://attack.mitre.org/tactics/${key}/`
        };
    }

    const technique = id.trim().match(TECHNIQUE_RE);
    if (!technique) {
        return undefined;
    }
    const base = technique[1].toUpperCase();
    const sub = technique[2];
    const full = sub ? `${base}.${sub}` : base;
    const name = TECHNIQUES[full] ?? TECHNIQUES[base];
    if (!name) {
        return {
            id: full,
            kind: 'technique',
            name: 'MITRE ATT&CK technique',
            url: `https://attack.mitre.org/techniques/${base}${sub ? `/${sub}` : ''}/`
        };
    }
    return {
        id: full,
        kind: 'technique',
        name,
        url: `https://attack.mitre.org/techniques/${base}${sub ? `/${sub}` : ''}/`
    };
}
