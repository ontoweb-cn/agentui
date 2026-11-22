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
              'This wizard guides you through connecting your first harness backend. You can configure Intellect Community, Intellect Enterprise, or other OpenAI-compatible backends.',
            steps:
              'You will: select a backend type → enter connection info → probe → confirm → done.',
            note: 'Token is sent over HTTPS only. Response will not include the plaintext token; instead an .env snippet is provided for persistence.',
            start: 'Start Setup',
          },
          selectType: {
            title: 'Select Backend Type',
            description: 'Choose the harness backend platform you want to connect to.',
            defaultEndpoint: 'Default endpoint',
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
            // adminTokenEnvVar/adminTokenEnvVarHint removed: BFF auto-generates HARNESS_<ID>_TOKEN
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
            // wizard-sso (P2): SSO summary row
            sso: 'Unified authentication (SSO)',
            ssoEnabled: 'Enabled',
            ssoAllChannels: 'All channels (unfiltered)',
          },
          done: {
            title: 'Setup Complete',
            description:
              'Backend has been configured successfully. You can now start using the platform.',
            goHome: 'Go to Home',
            warnings: 'Notes',
          },
          // wizard-sso (P2): unified authentication (SSO) configuration block
          sso: {
            enable: 'Enable unified authentication (SSO) login',
            skipHint:
              'You can skip this and configure it later in system settings. Once enabled, end users can sign in via unified authentication without a password.',
            channels: 'Login channels',
            fetchChannels: 'Fetch login channels',
            needEndpoint:
              'Enter the enterprise gateway endpoint first, then fetch login channels.',
            fetchFailed:
              'Failed to fetch login channels. Retry later or skip SSO.',
            noChannels:
              'No login channels are available yet from the unified authentication service. Configure later or skip SSO.',
            misconfigured: 'Misconfigured, unavailable',
            whitelistHint:
              'Select channels to show on the login page. Select none to show all available channels.',
            publicOrigin: 'Public origin',
            httpWarning:
              'Currently http://: production requires https or BFF startup validation will fail (intranet debugging may set BFF_ALLOW_INSECURE_SSO=true).',
            secret: 'Bootstrap secret',
            secretPlaceholder:
              'Not generated yet. Copy it to the deployment config after generating',
            generate: 'Generate',
            regenerate: 'Regenerate',
            copy: 'Copy',
            secretCopied:
              'Secret copied. Paste it into BFF_SSO_STATE_SECRET in your .env file',
            copyFailed: 'Copy failed. Please select and copy manually',
            secretHint:
              'The secret is visible only in this session and never appears in config files or API responses. Regenerate it after a page refresh.',
            silentRelogin: 'Silent re-login after session expiry',
            fetching: 'Fetching...',
            refetch: 'Refresh',
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
