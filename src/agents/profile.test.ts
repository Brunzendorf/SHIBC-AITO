import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs modules before imports
vi.mock('fs/promises', () => ({
  readFile: vi.fn<any, any>(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn<any, any>(),
}));

// Mock logger
vi.mock('../lib/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Import after mocks
import {
  loadProfile,
  generateSystemPrompt,
  type AgentProfile,
} from './profile.js';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

const mockReadFile = vi.mocked(readFile);
const mockExistsSync = vi.mocked(existsSync);

describe('profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadProfile', () => {
    const mockProfileContent = `# Chief Marketing Officer

## Identity

**Role:** Chief Marketing Officer
**Codename:** SHIBC-CMO-001
**Department:** Marketing & Community
**Reports To:** CEO Agent
**Manages:** Social Media Team

## Mission Statement

Drive organic growth through authentic community engagement and strategic marketing initiatives.

## Core Responsibilities

- Manage social media presence across all platforms
- Create and execute marketing campaigns
- Build and nurture community relationships
- Monitor and respond to community feedback
- Track marketing metrics and KPIs

## Decision Authority

### Kann alleine entscheiden

- Post social media updates
- Respond to community questions
- Create marketing content

### Braucht CEO Genehmigung

- Launch new marketing campaigns
- Partner with influencers
- Allocate marketing budget over $500

### Braucht DAO Vote

- Major rebranding initiatives
- Change core messaging strategy

## Loop Schedule

Alle 4 Stunden

- Check social media metrics
- Respond to community engagement
- Post scheduled content

## Key Metrics

- Social media engagement rate
- Community growth rate
- Campaign conversion rates

## Communication Style

Professional yet friendly. Engage with authenticity.

## Guiding Principles

- Transparency is key
- Community comes first
- Data-driven decisions
- Authentic engagement

## Startup Prompt

\`\`\`
Initialize as CMO. Review recent social metrics and plan today's content.
\`\`\`

## MCP Workers

For external tool access, spawn MCP Workers using this format:

\`\`\`json
{
  "actions": [{
    "type": "spawn_worker",
    "task": "Post message to Telegram: Hello community!",
    "servers": ["telegram"],
    "timeout": 60000
  }]
}
\`\`\`

Available MCP servers:
- telegram: Telegram Bot API
- fetch: HTTP requests
`;

    it('should load and parse a complete profile', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(mockProfileContent);

      const profile = await loadProfile('/path/to/cmo.md', 'cmo');

      expect(profile.type).toBe('cmo');
      expect(profile.name).toBe('Chief Marketing Officer');
      expect(profile.codename).toBe('SHIBC-CMO-001');
      expect(profile.department).toBe('Marketing & Community');
      expect(profile.reportsTo).toBe('CEO Agent');
      expect(profile.manages).toBe('Social Media Team');
      expect(profile.mission).toContain('Drive organic growth');
      expect(profile.rawContent).toBe(mockProfileContent);
    });

    it('should parse core responsibilities', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(mockProfileContent);

      const profile = await loadProfile('/path/to/cmo.md', 'cmo');

      expect(profile.responsibilities).toContain('Manage social media presence across all platforms');
      expect(profile.responsibilities).toContain('Create and execute marketing campaigns');
      expect(profile.responsibilities.length).toBeGreaterThan(0);
    });

    it('should parse decision authority sections', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(mockProfileContent);

      const profile = await loadProfile('/path/to/cmo.md', 'cmo');

      expect(profile.decisionAuthority.solo).toContain('Post social media updates');
      expect(profile.decisionAuthority.ceoApproval).toContain('Launch new marketing campaigns');
      expect(profile.decisionAuthority.daoVote).toContain('Major rebranding initiatives');
    });

    it('should parse loop interval from "Alle X Stunden"', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(mockProfileContent);

      const profile = await loadProfile('/path/to/cmo.md', 'cmo');

      expect(profile.loopInterval).toBe(14400); // 4 hours * 3600
    });

    it('should parse loop interval from "X Sekunden"', async () => {
      const content = mockProfileContent.replace('Alle 4 Stunden', '900 Sekunden');
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(content);

      const profile = await loadProfile('/path/to/test.md', 'cmo');

      expect(profile.loopInterval).toBe(900);
    });

    it('should parse loop interval from "Jede Stunde"', async () => {
      const content = mockProfileContent.replace('Alle 4 Stunden', 'Jede Stunde');
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(content);

      const profile = await loadProfile('/path/to/test.md', 'cmo');

      expect(profile.loopInterval).toBe(3600);
    });

    it('should default to 3600 seconds when no interval found', async () => {
      const content = mockProfileContent.replace('Alle 4 Stunden', 'No interval here');
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(content);

      const profile = await loadProfile('/path/to/test.md', 'cmo');

      expect(profile.loopInterval).toBe(3600);
    });

    it('should parse loop actions', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(mockProfileContent);

      const profile = await loadProfile('/path/to/cmo.md', 'cmo');

      expect(profile.loopActions).toContain('Check social media metrics');
      expect(profile.loopActions).toContain('Respond to community engagement');
      expect(profile.loopActions).toContain('Post scheduled content');
    });

    it('should parse key metrics', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(mockProfileContent);

      const profile = await loadProfile('/path/to/cmo.md', 'cmo');

      expect(profile.metrics).toContain('Social media engagement rate');
      expect(profile.metrics).toContain('Community growth rate');
      expect(profile.metrics).toContain('Campaign conversion rates');
    });

    it('should parse guiding principles', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(mockProfileContent);

      const profile = await loadProfile('/path/to/cmo.md', 'cmo');

      expect(profile.guidingPrinciples).toContain('Transparency is key');
      expect(profile.guidingPrinciples).toContain('Community comes first');
      expect(profile.guidingPrinciples).toContain('Data-driven decisions');
      expect(profile.guidingPrinciples).toContain('Authentic engagement');
    });

    it('should parse startup prompt from code block', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(mockProfileContent);

      const profile = await loadProfile('/path/to/cmo.md', 'cmo');

      expect(profile.startupPrompt).toContain('Initialize as CMO');
      expect(profile.startupPrompt).toContain('Review recent social metrics');
      expect(profile.startupPrompt).not.toContain('```');
    });

    it('should handle startup prompt without code block', async () => {
      const content = mockProfileContent.replace(/```[\s\S]*?```/, 'Just plain text startup');
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(content);

      const profile = await loadProfile('/path/to/test.md', 'cmo');

      expect(profile.startupPrompt).toContain('Just plain text startup');
    });

    it('should throw error when profile file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      await expect(loadProfile('/nonexistent/path.md', 'cmo')).rejects.toThrow(
        'Profile file not found: /nonexistent/path.md'
      );
    });

    it('should use defaults when identity fields are missing', async () => {
      const minimalContent = `# Minimal Profile

## Mission Statement

Test mission

## Core Responsibilities

- Task 1
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(minimalContent);

      const profile = await loadProfile('/path/to/minimal.md', 'cto');

      expect(profile.type).toBe('cto');
      expect(profile.name).toBe('CTO Agent'); // Default
      expect(profile.codename).toBe('SHIBC-CTO-001'); // Default
      expect(profile.department).toBe('Unknown'); // Default
      expect(profile.reportsTo).toBe('CEO Agent'); // Default
      expect(profile.manages).toBeUndefined();
    });

    it('should handle numbered lists in bullet points', async () => {
      const content = `# Profile

## Core Responsibilities

1. First responsibility
2. Second responsibility
3. Third responsibility

## Key Metrics

1. Metric one
2. Metric two
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(content);

      const profile = await loadProfile('/path/to/test.md', 'cfo');

      expect(profile.responsibilities).toContain('First responsibility');
      expect(profile.responsibilities).toContain('Second responsibility');
      expect(profile.responsibilities).toContain('Third responsibility');
      expect(profile.metrics).toContain('Metric one');
      expect(profile.metrics).toContain('Metric two');
    });

    it('should handle asterisk bullets', async () => {
      const content = `# Profile

## Core Responsibilities

* Task with asterisk
* Another asterisk task
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(content);

      const profile = await loadProfile('/path/to/test.md', 'coo');

      expect(profile.responsibilities).toContain('Task with asterisk');
      expect(profile.responsibilities).toContain('Another asterisk task');
    });

    it('should handle empty decision authority sections', async () => {
      const content = `# Profile

## Decision Authority

### Kann alleine entscheiden

### Braucht CEO Genehmigung

- One CEO item

### Braucht DAO Vote
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(content);

      const profile = await loadProfile('/path/to/test.md', 'cco');

      expect(profile.decisionAuthority.solo).toEqual([]);
      expect(profile.decisionAuthority.ceoApproval).toContain('One CEO item');
      expect(profile.decisionAuthority.daoVote).toEqual([]);
    });

    it('should limit communication style to 500 chars', async () => {
      const longCommunicationStyle = 'A'.repeat(1000);
      const content = `# Profile

## Communication Style

${longCommunicationStyle}
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(content);

      const profile = await loadProfile('/path/to/test.md', 'cmo');

      expect(profile.communicationStyle.internal?.length).toBeLessThanOrEqual(500);
    });

    it('should handle profile with manages field', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(mockProfileContent);

      const profile = await loadProfile('/path/to/cmo.md', 'cmo');

      expect(profile.manages).toBe('Social Media Team');
    });

    it('should preserve raw content', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(mockProfileContent);

      const profile = await loadProfile('/path/to/cmo.md', 'cmo');

      expect(profile.rawContent).toBe(mockProfileContent);
      expect(profile.rawContent).toContain('## MCP Workers');
    });
  });

  describe('generateSystemPrompt', () => {
    const mockProfile: AgentProfile = {
      type: 'cmo',
      name: 'Chief Marketing Officer',
      codename: 'SHIBC-CMO-001',
      department: 'Marketing',
      reportsTo: 'CEO Agent',
      manages: 'Social Team',
      mission: 'Drive marketing initiatives',
      responsibilities: ['Manage social media', 'Create campaigns', 'Track metrics'],
      decisionAuthority: {
        solo: ['Post tweets'],
        ceoApproval: ['Launch campaigns'],
        daoVote: ['Rebrand'],
      },
      loopInterval: 3600,
      loopActions: ['Check metrics'],
      metrics: ['Engagement rate'],
      communicationStyle: {
        internal: 'Professional and data-driven',
      },
      guidingPrinciples: ['Be transparent', 'Engage authentically', 'Data-driven'],
      startupPrompt: 'Initialize marketing operations',
      rawContent: `# CMO Profile

## Mission Statement
Drive marketing initiatives

## MCP Workers

Use MCP workers for external tools.

Available servers:
- telegram
- fetch
`,
    };

    it('should generate complete system prompt', () => {
      const prompt = generateSystemPrompt(mockProfile);

      expect(prompt).toContain('# Chief Marketing Officer');
      expect(prompt).toContain('## Identity');
      expect(prompt).toContain('Codename: SHIBC-CMO-001');
      expect(prompt).toContain('Department: Marketing');
      expect(prompt).toContain('Reports To: CEO Agent');
      expect(prompt).toContain('Manages: Social Team');
    });

    it('should include mission statement', () => {
      const prompt = generateSystemPrompt(mockProfile);

      expect(prompt).toContain('## Mission');
      expect(prompt).toContain('Drive marketing initiatives');
    });

    it('should include all responsibilities as bullet points', () => {
      const prompt = generateSystemPrompt(mockProfile);

      expect(prompt).toContain('## Core Responsibilities');
      expect(prompt).toContain('- Manage social media');
      expect(prompt).toContain('- Create campaigns');
      expect(prompt).toContain('- Track metrics');
    });

    it('should include all guiding principles as bullet points', () => {
      const prompt = generateSystemPrompt(mockProfile);

      expect(prompt).toContain('## Guiding Principles');
      expect(prompt).toContain('- Be transparent');
      expect(prompt).toContain('- Engage authentically');
      expect(prompt).toContain('- Data-driven');
    });

    it('should include startup prompt', () => {
      const prompt = generateSystemPrompt(mockProfile);

      expect(prompt).toContain('## Startup');
      expect(prompt).toContain('Initialize marketing operations');
    });

    it('should include MCP Workers section when present', () => {
      const prompt = generateSystemPrompt(mockProfile);

      expect(prompt).toContain('## MCP Workers');
      expect(prompt).toContain('Use MCP workers for external tools');
      expect(prompt).toContain('telegram');
      expect(prompt).toContain('fetch');
    });

    it('should not include MCP section when not in raw content', () => {
      const profileWithoutMCP: AgentProfile = {
        ...mockProfile,
        rawContent: `# CMO Profile

## Mission Statement
Drive marketing initiatives

## Other Section
No MCP here
`,
      };

      const prompt = generateSystemPrompt(profileWithoutMCP);

      expect(prompt).not.toContain('## MCP Workers');
    });

    it('should filter out empty strings from prompt parts', () => {
      const profileNoManages: AgentProfile = {
        ...mockProfile,
        manages: undefined,
      };

      const prompt = generateSystemPrompt(profileNoManages);

      // Should not have empty lines where manages would be
      expect(prompt).not.toContain('Manages: \n');
      expect(prompt).toContain('Reports To: CEO Agent');
    });

    it('should handle profile with minimal fields', () => {
      const minimalProfile: AgentProfile = {
        type: 'dao',
        name: 'DAO Agent',
        codename: 'SHIBC-DAO-001',
        department: 'Governance',
        reportsTo: 'Community',
        mission: 'Decentralized governance',
        responsibilities: [],
        decisionAuthority: {
          solo: [],
          ceoApproval: [],
          daoVote: [],
        },
        loopInterval: 7200,
        loopActions: [],
        metrics: [],
        communicationStyle: {},
        guidingPrinciples: [],
        startupPrompt: 'Initialize DAO',
        rawContent: '# DAO',
      };

      const prompt = generateSystemPrompt(minimalProfile);

      expect(prompt).toContain('# DAO Agent');
      expect(prompt).toContain('## Mission');
      expect(prompt).toContain('Decentralized governance');
    });

    it('should extract MCP section that ends at next non-MCP section', () => {
      const profileWithMultipleSections: AgentProfile = {
        ...mockProfile,
        rawContent: `# Profile

## Mission Statement
Drive marketing

## MCP Workers

Use spawn_worker action.

Servers:
- telegram
- fetch

## Other Section

This should not be included in MCP section.
`,
      };

      const prompt = generateSystemPrompt(profileWithMultipleSections);

      expect(prompt).toContain('## MCP Workers');
      expect(prompt).toContain('Use spawn_worker action');
      expect(prompt).toContain('telegram');
      expect(prompt).toContain('fetch');
      expect(prompt).not.toContain('## Other Section');
    });

    it('should extract MCP section that ends at document boundary', () => {
      const profileMCPAtEnd: AgentProfile = {
        ...mockProfile,
        rawContent: `# Profile

## Mission Statement
Test

## MCP Workers

MCP content here.

Available: telegram, fetch
`,
      };

      const prompt = generateSystemPrompt(profileMCPAtEnd);

      expect(prompt).toContain('## MCP Workers');
      expect(prompt).toContain('MCP content here');
      expect(prompt).toContain('Available: telegram, fetch');
    });

    it('should extract MCP section that ends at end of file', () => {
      const profileWithHR: AgentProfile = {
        ...mockProfile,
        rawContent: `# Profile

## MCP Workers

MCP info and more content
`,
      };

      const prompt = generateSystemPrompt(profileWithHR);

      expect(prompt).toContain('## MCP Workers');
      expect(prompt).toContain('MCP info and more content');
    });

    it('should handle case-insensitive MCP section matching', () => {
      const profileLowerCase: AgentProfile = {
        ...mockProfile,
        rawContent: `# Profile

## mcp workers

Content here
`,
      };

      const prompt = generateSystemPrompt(profileLowerCase);

      expect(prompt.toLowerCase()).toContain('mcp workers');
      expect(prompt).toContain('Content here');
    });

    it('should join prompt parts with newlines correctly', () => {
      const prompt = generateSystemPrompt(mockProfile);

      // Should have proper sections separated by blank lines
      const lines = prompt.split('\n');
      expect(lines.length).toBeGreaterThan(10);
      expect(lines).toContain(''); // Should have blank lines
    });
  });

  describe('edge cases', () => {
    it('should handle profile with special characters in fields', async () => {
      const content = `# Profile

## Identity

**Role:** CMO & Community Manager
**Codename:** SHIBC-CMO-001
**Department:** Marketing/PR & Social

## Mission Statement

Drive growth with data-driven approaches & authentic engagement.

## Core Responsibilities

- Manage @Twitter, @Telegram & @Discord
- Create content (videos, posts & graphics)
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(content);

      const profile = await loadProfile('/path/to/test.md', 'cmo');

      expect(profile.name).toContain('&');
      expect(profile.department).toContain('/');
      expect(profile.responsibilities[0]).toContain('@');
    });

    it('should handle very long profile content', async () => {
      const longResponsibility = 'A'.repeat(5000);
      const content = `# Profile

## Core Responsibilities

- ${longResponsibility}
- Normal task
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(content);

      const profile = await loadProfile('/path/to/test.md', 'cto');

      expect(profile.responsibilities).toHaveLength(2);
      expect(profile.responsibilities[0].length).toBe(5000);
    });

    it('should handle profiles with unusual whitespace', async () => {
      const content = `#    Profile

##   Identity

**Role:**    CMO
**Codename:**  SHIBC-CMO-001

##   Mission Statement

   Test mission with spaces

## Core Responsibilities

  -   Responsibility with spaces
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(content);

      const profile = await loadProfile('/path/to/test.md', 'cmo');

      expect(profile.name).toBe('CMO');
      expect(profile.codename).toBe('SHIBC-CMO-001');
      expect(profile.responsibilities[0]).toBe('Responsibility with spaces');
    });

    it('should handle profiles without any sections', async () => {
      const content = 'Just some text without proper sections';
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(content);

      const profile = await loadProfile('/path/to/test.md', 'dao');

      expect(profile.type).toBe('dao');
      expect(profile.name).toBe('DAO Agent'); // Default
      expect(profile.responsibilities).toEqual([]);
      expect(profile.metrics).toEqual([]);
    });

    it('should handle Unicode characters in profile', async () => {
      const content = `# Profile 🚀

## Mission Statement

Grow SHIBC ecosystem 🌟 with authentic engagement 💯

## Core Responsibilities

- Build community 🤝
- Create content 📝
- Track metrics 📊
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(content);

      const profile = await loadProfile('/path/to/test.md', 'cmo');

      expect(profile.mission).toContain('🌟');
      expect(profile.responsibilities[0]).toContain('🤝');
      expect(profile.responsibilities[1]).toContain('📝');
    });
  });
});
