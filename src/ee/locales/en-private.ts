/** T3.4 ee i18n overlay — agentui-private keys. Shared en/zh stay cherry-pickable. */
export default {
  translation: {
        tasks: {
          searchPlaceholder: 'Search tasks',
          duration: 'Duration {{duration}}',
          groupToday: 'Today',
          groupYesterday: 'Yesterday',
          groupEarlier: 'Earlier',
          empty: 'No tasks yet',
          loading: 'Loading...',
        },
        wizard: {
          title: 'Setup Wizard',
          subtitle: 'Connect your first harness backend',
          step: {
            welcome: 'Welcome',
            selectType: 'Select Type',
            connection: 'Connection',
            probe: 'Probe',
            confirm: 'Confirm',
            done: 'Done',
          },
          welcome: {
            title: 'Welcome to Setup',
            description:
              'This wizard guides you through connecting your first harness backend. You can configure Intellect Enterprise, Intellect Community, HERMES, AgentScope and other OpenAI-compatible backends.',
            steps:
              'You will: select a backend type → enter connection info → probe → confirm → done.',
            note: 'Credentials are sent over HTTPS only and never echoed back. Anything that must go into deployment configuration is provided as an .env snippet.',
            start: 'Start Setup',
          },
          selectType: {
            title: 'Select Backend Type',
            description: 'Choose the harness backend platform you want to connect to.',
            defaultEndpoint: 'Default endpoint',
          },
          types: {
            enterprise: 'Intellect Enterprise',
            enterpriseDesc: 'Teams/projects with multi-tenancy; member password sign-in',
          },
          cap: {
            canvas: 'Canvas',
            knowledgeBase: 'KnowledgeBase',
            multiTenant: 'MultiTenant',
            modelManagement: 'ModelMgmt',
          },
          connection: {
            title: 'Connection Information',
            description:
              'Enter the backend endpoint and credentials. Token is sent over HTTPS and not stored in plaintext.',
            name: 'Backend Name',
            endpoint: 'Endpoint',
            token: 'Bearer Token',
            email: 'Email',
            password: 'Password',
            intellectTenantId: 'Intellect Tenant ID',
            intellectTenantIdError: 'Invalid format: must be 32-char hex (0-9, a-f)',
            intellectTenantIdHint:
              'Copy from intellect-team INTELLECT_TENANT_ID env var (Rust version requires 32-char hex)',
            probe: 'Probe Connection',
          },
          probe: {
            title: 'Connection Probe',
            description: 'Verifying backend reachability and discovering capabilities.',
            probing: 'Probing...',
            healthy: 'Backend is reachable',
            capabilities: 'Discovered capabilities',
            failed: 'Probe failed',
            continue: 'Continue',
            retry: 'Retry',
          },
          confirm: {
            title: 'Confirm Setup',
            description:
              'Review the configuration. On confirm, a backend config will be created.',
            name: 'Name',
            type: 'Type',
            endpoint: 'Endpoint',
            envVar: 'Env Var',
            tenantId: 'Tenant ID',
            envSnippet: '.env snippet (copy to your .env file)',
            error: 'Error',
            submit: 'Create Backend',
          },
          done: {
            title: 'Setup Complete',
            description:
              'Backend has been configured successfully. You can now start using the platform.',
            // wizard-ent-sso-mode v1.4: SSO moved to admin settings
            enterpriseSsoHint:
              'To enable unified authentication (SSO) sign-in, go to System → Unified authentication settings after setup.',
            goHome: 'Go to Home',
            warnings: 'Notes',
          },
          toast: {
            success: 'Backend created successfully',
            failed: 'Setup failed',
          },
        },
        taskSidebar: {
          create: 'New Task',
          search: 'Search tasks',
          empty: 'No tasks',
          filterAll: 'All',
          filterRunning: 'Running',
          filterCompleted: 'Completed',
          filterFailed: 'Failed',
          filterCancelled: 'Cancelled',
          filterPending: 'Pending',
        },
        taskCard: {
          statusRunning: 'Running',
          statusCompleted: 'Completed',
          statusFailed: 'Failed',
          statusCancelled: 'Cancelled',
          statusPending: 'Pending',
          retry: 'Retry',
          delete: 'Delete',
        },
        toolPanelHost: {
          title: 'Tools',
          collapse: 'Collapse tool panel',
        },
        toolPanel: {
          unreadBadge: '{{count}} unread',
          loading: 'Loading...',
        },
        taskProgress: {
          expand: 'Expand',
          collapse: 'Collapse',
          statusRunning: 'Running',
          statusCompleted: 'Completed',
          statusFailed: 'Failed',
          statusCancelled: 'Cancelled',
          statusPending: 'Pending',
          statusSkipped: 'Skipped',
        },
        modeSwitcher: {
          label: 'Work mode switcher',
          work: 'Work',
          code: 'Code',
          canvas: 'Canvas',
        },
        approval: {
          choiceOnce: 'Allow once',
          choiceSession: 'Allow for session',
          choiceAlways: 'Always allow',
          choiceDeny: 'Deny',
          pending: 'Awaiting approval',
          submitted: 'Submitted: {{choice}}',
          submitFailed: 'Submit failed, please retry',
          // P2-Q4: submitApproval error scenario messages
          notSupported: 'Tool approval not supported in this session',
          forbidden: 'No permission to approve this tool call',
          alreadyResolved: 'Approval request already resolved or invalid',
        },
        clarify: {
          pending: 'Awaiting answer',
          submitted: 'Answered',
          submitFailed: 'Submit failed, please retry',
          notSupported: 'Clarify not supported in this session',
          inputPlaceholder: 'Type your answer...',
          submit: 'Submit',
          yourAnswer: 'Your answer',
          waiting: 'Waiting to continue...',
          defaultQuestion: 'More information needed',
        },
        offline: {
          browser: 'Network connection lost',
          retry: 'Retry now',
          probing: 'Probing...',
          retryTip: 'Manually check network status',
        },
        context: {
          prompt: 'Prompt',
          completion: 'Completion',
          length: 'Context length',
          usage: 'Usage',
          tooltipTokens: 'Tokens: {{used}} / {{total}}',
          tooltipCompress: 'Context near limit, use /compress to compress',
        },
        command: {
          placeholder: 'Type a command or search...',
          noResult: 'No matching command',
          retry: {
            desc: 'Regenerate the last reply',
          },
          undo: {
            desc: 'Undo the last user message',
          },
          status: {
            desc: 'View session status',
          },
          usage: {
            desc: 'View token usage',
          },
          model: {
            desc: 'Switch model',
            argName: 'model_name',
          },
        },
        selectedReply: {
          button: 'Quote reply',
          multiChatBoxTip: 'Please switch to single chat box mode to use this feature',
        },
        streamStatus: {
          workingFor: 'Working for {{duration}}',
          doneIn: 'Done in {{duration}}',
          failedIn: 'Failed after {{duration}}',
          stoppedIn: 'Stopped after {{duration}}',
          tools_one: '{{count}} tool',
          tools_other: '{{count}} tools',
        },
        workspace: {
          title: 'Workspace',
          close: 'Close workspace',
          files: 'Files',
          references: 'References',
          uploads: 'Uploaded files',
          downloads: 'Downloads',
          emptyFiles: 'No files in this conversation',
          emptyReferences: 'No referenced documents in this conversation',
        },
    admin: {
        harnessBackends: {
          kagHint:
            'KAG uses the MCP protocol family (spec-012). It is configured manually here only and is not offered in the setup wizard.',
        },
        ssoSettings: {
          // wizard-ent-sso-mode v1.4(§11.2): precondition card + channels preview
          preconditionTitle: 'Precondition status',
          preconditionDesc:
            'Live checks against the enterprise backend bound to the default tenant (gateway / tenant / service key / sign-in service); run a check before enabling.',
          recheck: 'Re-run checks',
          checking: 'Checking...',
          checkNotRun: 'Not checked yet; click "Re-run checks" for live status.',
          noBackend:
            'No enterprise backend is bound to the default tenant: SSO exchange cannot be routed. Complete the enterprise first-install or bind one in System → Harness backends.',
          boundBackend: 'Enterprise backend: {{id}} ({{endpoint}})',
          checkGateway: 'Authentication gateway reachable',
          checkTenant: 'Enterprise tenant ID',
          checkKey: 'Gateway service key',
          checkProviders: 'Unified sign-in service',
          checkProvidersCount: '{{count}} channel(s) available',
          checkUnknown: 'Undeterminable; verified on first use',
          stateSecretLabel: 'BFF_SSO_STATE_SECRET (deployment config)',
          stateSecretSet: 'Set',
          stateSecretInvalid: 'Set but shorter than 32 characters',
          stateSecretUnset: 'Not set',
          secretInvalid:
            'Unified authentication is enabled, but BFF_SSO_STATE_SECRET is shorter than 32 characters: the BFF will fail to start after a restart. Fix it in the deployment config first.',
          enableDisabledHint:
            'No enterprise backend is bound to the default tenant; enabling is unavailable until the enterprise first-install is done.',
          providersLoading: 'Loading channels...',
          providersError:
            'Channel preview unavailable (no bound backend or the unified sign-in service is unreachable); use the manual field below as a fallback.',
          providersEmpty:
            'The gateway has no usable login channel yet; configure it on the gateway side and fetch again.',
          providerMisconfigured: 'Misconfigured, unavailable',
          providersManualHint:
            'Manual fallback: comma-separated channel IDs (synced with the checkboxes above); leave empty = no filtering.',
          verifyHint:
            'After saving, open the login page (/login-next) — SSO channel buttons should appear. Also confirm the IdP/gateway redirect_uris allowlist contains "public origin + /api/bff/auth/oauth/callback".',
          title: 'Unified authentication settings',
          subtitle:
            'Runtime configuration for SSO login. Changes take effect immediately without a restart.',
          cardTitle: 'Effective configuration',
          updatedAt: 'Runtime config updated at {{time}}',
          noRuntime:
            'No runtime config yet. The values below come from deployment env vars.',
          secretMissing:
            'SSO is enabled but BFF_SSO_STATE_SECRET is missing from the deployment config: BFF will fail to start after a restart. Set it in .env first (at least 32 characters).',
          enable: 'Enable unified authentication login',
          enableHint:
            'Shows SSO channel buttons on the login page; effective for enterprise tenants only.',
          publicOrigin: 'Public origin',
          httpWarning:
            'Currently http://: production requires https or BFF startup validation will fail (intranet debugging may set BFF_ALLOW_INSECURE_SSO=true).',
          providers: 'Channel allowlist',
          providersHint:
            'Comma-separated channel IDs. Leave empty to disable filtering (gateway enabled/usage wins).',
          silentRelogin: 'Silent re-login',
          silentReloginHint:
            'Automatically restores the session without prompting when it expires; explicit logout is not auto-relogged.',
          secretNote:
            'The bootstrap secret (BFF_SSO_STATE_SECRET) is deployment-level sensitive configuration. It is never shown or edited here and stays in the deployment config file.',
          save: 'Save',
          saved: 'SSO configuration saved and effective immediately',
          saveFailed: 'Save failed',
          reset: 'Fall back to env vars',
          resetDone: 'Runtime config cleared; falling back to deployment env vars',
          sourceRuntime: 'Runtime config',
          sourceEnv: 'Env var',
        },
        tenantBinding: {
          title: 'Tenant bindings',
          description: 'Manage team/project binding for tenant "{{tenant}}"',
          currentStatus: 'Current status',
          default: 'Default (TenantID=0)',
          isolated: 'Isolated',
          team: 'Team',
          teamPlaceholder: 'Select a team',
          teamHint: 'Bind a real team_id to enable in-instance Team data isolation (tenant isolation is via multi-instance: different intellectBackendId)',
          defaultTeam: 'Default (no team)',
          project: 'Project',
          projectPlaceholder: 'Select a project (optional)',
          projectHint: 'Optional project binding within the selected team',
          noProject: 'No project',
          selectTenantHint: 'Please select a tenant from the harness-backends page',
        },
    },
  },
};
