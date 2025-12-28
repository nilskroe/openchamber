import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ButtonSmall } from '@/components/ui/button-small';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { useAgentsStore, type AgentConfig } from '@/stores/useAgentsStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { RiAddLine, RiAiAgentFill, RiAiAgentLine, RiInformationLine, RiRobot2Line, RiRobotLine, RiSaveLine, RiSubtractLine } from '@remixicon/react';
import { cn } from '@/lib/utils';
import { ModelSelector } from './ModelSelector';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { useAvailableTools } from '@/hooks/useAvailableTools';

export const AgentsPage: React.FC = () => {
    const { t } = useTranslation(['settings', 'common']);
    const { selectedAgentName, getAgentByName, createAgent, updateAgent, agents } = useAgentsStore();
    useConfigStore();
    const { tools: availableTools } = useAvailableTools();

    const selectedAgent = selectedAgentName ? getAgentByName(selectedAgentName) : null;
    const isNewAgent = selectedAgentName && !selectedAgent;

    const [name, setName] = React.useState('');
    const [description, setDescription] = React.useState('');
    const [mode, setMode] = React.useState<'primary' | 'subagent' | 'all'>('subagent');
    const [model, setModel] = React.useState('');
    const [temperature, setTemperature] = React.useState<number | undefined>(undefined);
    const [topP, setTopP] = React.useState<number | undefined>(undefined);
    const [prompt, setPrompt] = React.useState('');
    const [tools, setTools] = React.useState<Record<string, boolean>>({});
    const [editPermission, setEditPermission] = React.useState<'allow' | 'ask' | 'deny' | 'full'>('allow');
    const [webfetchPermission, setWebfetchPermission] = React.useState<'allow' | 'ask' | 'deny'>('allow');
    const [bashPermission, setBashPermission] = React.useState<'allow' | 'ask' | 'deny'>('ask');
    const [isSaving, setIsSaving] = React.useState(false);

    React.useEffect(() => {
        if (isNewAgent) {

            setName(selectedAgentName || '');
            setDescription('');
            setMode('subagent');
            setModel('');
            setTemperature(undefined);
            setTopP(undefined);
            setPrompt('');
            setTools({});
            setEditPermission('allow');
            setWebfetchPermission('allow');
            setBashPermission('ask');
        } else if (selectedAgent) {

            setName(selectedAgent.name);
            setDescription(selectedAgent.description || '');
            setMode(selectedAgent.mode || 'subagent');

            if (selectedAgent.model?.providerID && selectedAgent.model?.modelID) {
                setModel(`${selectedAgent.model.providerID}/${selectedAgent.model.modelID}`);
            } else {
                setModel('');
            }

            setTemperature(selectedAgent.temperature);
            setTopP(selectedAgent.topP);
            setPrompt(selectedAgent.prompt || '');
            setTools(selectedAgent.tools || {});

            if (selectedAgent.permission) {
                const editMode = selectedAgent.permission.edit;
                if (editMode === 'allow' || editMode === 'ask' || editMode === 'deny' || editMode === 'full') {
                    setEditPermission(editMode);
                }
                if (selectedAgent.permission.webfetch) {
                    setWebfetchPermission(selectedAgent.permission.webfetch);
                }
                if (typeof selectedAgent.permission.bash === 'string') {
                    setBashPermission(selectedAgent.permission.bash as 'allow' | 'ask' | 'deny');
                }
            }

        }
    }, [selectedAgent, isNewAgent, selectedAgentName, agents]);

    const handleSave = async () => {

        if (!name.trim()) {
            toast.error(t('settings:agents.errors.nameRequired', 'Agent name is required'));
            return;
        }

        setIsSaving(true);

        try {
            const trimmedModel = model.trim();
            const config: AgentConfig = {
                name: name.trim(),
                description: description.trim() || undefined,
                mode,
                model: trimmedModel === '' ? null : trimmedModel,
                temperature,
                top_p: topP,
                prompt: prompt.trim() || undefined,
                tools: Object.keys(tools).length > 0 ? tools : undefined,
                permission: {
                    edit: editPermission,
                    webfetch: webfetchPermission,
                    bash: bashPermission,
                },
            };

            let success: boolean;
            if (isNewAgent) {
                success = await createAgent(config);
            } else {
                success = await updateAgent(name, config);
            }

            if (success) {
                toast.success(isNewAgent ? t('settings:agents.success.created', 'Agent created successfully') : t('settings:agents.success.updated', 'Agent updated successfully'));
            } else {
                toast.error(isNewAgent ? t('settings:agents.errors.createFailed', 'Failed to create agent') : t('settings:agents.errors.updateFailed', 'Failed to update agent'));
            }
        } catch (error) {
            console.error('Error saving agent:', error);
            toast.error(t('settings:agents.errors.saveFailed', 'An error occurred while saving'));
        } finally {
            setIsSaving(false);
        }
    };

    const toggleTool = (tool: string) => {
        setTools((prev) => ({
            ...prev,
            [tool]: !prev[tool],
        }));
    };

    const toggleAllTools = (enabled: boolean) => {
        const allTools: Record<string, boolean> = {};
        availableTools.forEach((tool: string) => {
            allTools[tool] = enabled;
        });
        setTools(allTools);
    };

    if (!selectedAgentName) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="text-center text-muted-foreground">
                    <RiRobot2Line className="mx-auto mb-3 h-12 w-12 opacity-50" />
                    <p className="typography-body">{t('settings:agents.selectFromSidebar', 'Select an agent from the sidebar')}</p>
                    <p className="typography-meta mt-1 opacity-75">{t('settings:agents.orCreateNew', 'or create a new one')}</p>
                </div>
            </div>
        );
    }

    return (
        <ScrollableOverlay outerClassName="h-full" className="mx-auto max-w-3xl space-y-6 p-6">
            {}
            <div className="space-y-1">
                <h1 className="typography-ui-header font-semibold text-lg">
                    {isNewAgent ? t('settings:agents.newAgent', 'New Agent') : name}
                </h1>
            </div>

            {}
            <div className="space-y-4">
                <div className="space-y-1">
                    <h2 className="typography-ui-header font-semibold text-foreground">{t('settings:agents.sections.basicInfo', 'Basic Information')}</h2>
                    <p className="typography-meta text-muted-foreground/80">
                        {t('settings:agents.sections.basicInfoDesc', 'Configure agent identity and metadata')}
                    </p>
                </div>

                <div className="space-y-2">
                    <label className="typography-ui-label font-medium text-foreground">
                        {t('settings:agents.fields.name', 'Agent Name')}
                    </label>
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t('settings:agents.fields.namePlaceholder', 'my-agent')}
                        disabled={!isNewAgent}
                    />
                </div>

                <div className="space-y-2">
                    <label className="typography-ui-label font-medium text-foreground">
                        {t('settings:agents.fields.description', 'Description')}
                    </label>
                    <Textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={t('settings:agents.fields.descriptionPlaceholder', 'What does this agent do?')}
                        rows={3}
                    />
                </div>

                <div className="space-y-2">
                    <label className="typography-ui-label font-medium text-foreground">
                        {t('settings:agents.fields.mode', 'Mode')}
                    </label>
                    <div className="flex gap-1 w-fit">
                        <ButtonSmall
                            variant={mode === 'primary' ? 'default' : 'outline'}
                            onClick={() => setMode('primary')}
                            className={cn('gap-2', mode === 'primary' ? undefined : 'text-foreground')}
                        >
                            <RiAiAgentLine className="h-3 w-3" />
                            {t('settings:agents.modes.primary', 'Primary')}
                        </ButtonSmall>
                        <ButtonSmall
                            variant={mode === 'subagent' ? 'default' : 'outline'}
                            onClick={() => setMode('subagent')}
                            className={cn('gap-2', mode === 'subagent' ? undefined : 'text-foreground')}
                        >
                            <RiRobotLine className="h-3 w-3" />
                            {t('settings:agents.modes.subagent', 'Subagent')}
                        </ButtonSmall>
                        <ButtonSmall
                            variant={mode === 'all' ? 'default' : 'outline'}
                            onClick={() => setMode('all')}
                            className={cn('gap-2', mode === 'all' ? undefined : 'text-foreground')}
                        >
                            <RiAiAgentFill className="h-3 w-3" />
                            {t('settings:agents.modes.all', 'All')}
                        </ButtonSmall>
                    </div>
                    <p className="typography-meta text-muted-foreground">
                        {t('settings:agents.fields.modeDescription', 'Primary: main agent, Subagent: helper agent, All: both modes')}
                    </p>
                </div>
            </div>

            {}
            <div className="space-y-4">
                <div className="space-y-1">
                    <h2 className="typography-h2 font-semibold text-foreground">{t('settings:agents.sections.modelConfig', 'Model Configuration')}</h2>
                    <p className="typography-meta text-muted-foreground/80">
                        {t('settings:agents.sections.modelConfigDesc', 'Configure model and generation parameters')}
                    </p>
                </div>

                <div className="space-y-2">
                    <label className="typography-ui-label font-medium text-foreground">
                        {t('settings:agents.fields.model', 'Model')}
                    </label>
                    <ModelSelector
                        providerId={model ? model.split('/')[0] : ''}
                        modelId={model ? model.split('/')[1] : ''}
                        onChange={(providerId: string, modelId: string) => {
                            if (providerId && modelId) {
                                setModel(`${providerId}/${modelId}`);
                            } else {
                                setModel('');
                            }
                        }}
                    />
                </div>

                <div className="flex gap-4">
                    <div className="space-y-2">
                        <label className="typography-ui-label font-medium text-foreground flex items-center gap-2">
                            {t('settings:agents.fields.temperature', 'Temperature')}
                            <Tooltip delayDuration={1000}>
                                <TooltipTrigger asChild>
                                    <RiInformationLine className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent sideOffset={8} className="max-w-xs">
                                    {t('settings:agents.tooltips.temperature', 'Controls randomness in responses. Lower values (0.0) make output more focused and deterministic. Higher values (1.0+) make output more creative and varied.')}
                                </TooltipContent>
                            </Tooltip>
                        </label>
                        <div className="relative w-32">
                            <button
                                type="button"
                                onClick={() => {
                                    const current = temperature !== undefined ? temperature : 0.7;
                                    const newValue = Math.max(0, current - 0.1);
                                    setTemperature(parseFloat(newValue.toFixed(1)));
                                }}
                                className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center justify-center h-6 w-6 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                            >
                                <RiSubtractLine className="h-3.5 w-3.5" />
                            </button>
                            <Input
                                type="text"
                                inputMode="decimal"
                                value={temperature !== undefined ? temperature : ''}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    if (value === '') {
                                        setTemperature(undefined);
                                        return;
                                    }
                                    const parsed = parseFloat(value);
                                    if (!isNaN(parsed) && parsed >= 0 && parsed <= 2) {
                                        setTemperature(parsed);
                                    }
                                }}
                                onBlur={(e) => {
                                    const value = e.target.value;
                                    if (value !== '') {
                                        const parsed = parseFloat(value);
                                        if (!isNaN(parsed)) {
                                            const clamped = Math.max(0, Math.min(2, parsed));
                                            setTemperature(parseFloat(clamped.toFixed(1)));
                                        }
                                    }
                                }}
                                placeholder="—"
                                className="text-center px-10 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    const current = temperature !== undefined ? temperature : 0.7;
                                    const newValue = Math.min(2, current + 0.1);
                                    setTemperature(parseFloat(newValue.toFixed(1)));
                                }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center h-6 w-6 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                            >
                                <RiAddLine className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="typography-ui-label font-medium text-foreground flex items-center gap-2">
                            {t('settings:agents.fields.topP', 'Top P')}
                            <Tooltip delayDuration={1000}>
                                <TooltipTrigger asChild>
                                    <RiInformationLine className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent sideOffset={8} className="max-w-xs">
                                    {t('settings:agents.tooltips.topP', 'Controls diversity via nucleus sampling. Lower values (0.1) focus on most likely tokens. Higher values (0.9) allow more diverse output.')}
                                </TooltipContent>
                            </Tooltip>
                        </label>
                        <div className="relative w-32">
                            <button
                                type="button"
                                onClick={() => {
                                    const current = topP !== undefined ? topP : 0.9;
                                    const newValue = Math.max(0, current - 0.1);
                                    setTopP(parseFloat(newValue.toFixed(1)));
                                }}
                                className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center justify-center h-6 w-6 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                            >
                                <RiSubtractLine className="h-3.5 w-3.5" />
                            </button>
                            <Input
                                type="text"
                                inputMode="decimal"
                                value={topP !== undefined ? topP : ''}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    if (value === '') {
                                        setTopP(undefined);
                                        return;
                                    }
                                    const parsed = parseFloat(value);
                                    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
                                        setTopP(parsed);
                                    }
                                }}
                                onBlur={(e) => {
                                    const value = e.target.value;
                                    if (value !== '') {
                                        const parsed = parseFloat(value);
                                        if (!isNaN(parsed)) {
                                            const clamped = Math.max(0, Math.min(1, parsed));
                                            setTopP(parseFloat(clamped.toFixed(1)));
                                        }
                                    }
                                }}
                                placeholder="—"
                                className="text-center px-10 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    const current = topP !== undefined ? topP : 0.9;
                                    const newValue = Math.min(1, current + 0.1);
                                    setTopP(parseFloat(newValue.toFixed(1)));
                                }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center h-6 w-6 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                            >
                                <RiAddLine className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {}
            <div className="space-y-4">
                <div className="space-y-1">
                    <h2 className="typography-h2 font-semibold text-foreground">{t('settings:agents.sections.systemPrompt', 'System Prompt')}</h2>
                    <p className="typography-meta text-muted-foreground/80">
                        {t('settings:agents.sections.systemPromptDesc', 'Override the default system prompt for this agent')}
                    </p>
                </div>
                <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={t('settings:agents.fields.systemPromptPlaceholder', 'Custom system prompt...')}
                    rows={8}
                    className="font-mono typography-meta"
                />
            </div>

            {}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <h2 className="typography-h2 font-semibold text-foreground">{t('settings:agents.sections.availableTools', 'Available Tools')}</h2>
                        <p className="typography-meta text-muted-foreground/80">
                            {t('settings:agents.sections.availableToolsDesc', 'Select tools this agent can access')}
                        </p>
                    </div>
                    <div className="flex gap-1 w-fit">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => toggleAllTools(true)}
                            className="h-6 px-2 text-xs"
                        >
                            {t('common:button.enableAll', 'Enable All')}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => toggleAllTools(false)}
                            className="h-6 px-2 text-xs"
                        >
                            {t('common:button.disableAll', 'Disable All')}
                        </Button>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2">
                    {availableTools.map((tool) => (
                        <button
                            key={tool}
                            type="button"
                            onClick={() => toggleTool(tool)}
                            className={cn(
                                "h-6 px-2 rounded-lg border text-[13px] cursor-pointer transition-colors",
                                tools[tool]
                                    ? "bg-primary border-primary text-primary-foreground"
                                    : "border-border/40 bg-sidebar/30 text-foreground hover:bg-sidebar/50"
                            )}
                        >
                            {tool}
                        </button>
                    ))}
                </div>
            </div>

            {}
            <div className="space-y-4">
                <div className="space-y-1">
                    <h2 className="typography-h2 font-semibold text-foreground">{t('settings:agents.sections.permissions', 'Permissions')}</h2>
                    <p className="typography-meta text-muted-foreground/80">
                        {t('settings:agents.sections.permissionsDesc', 'Configure permission levels for different actions')}
                    </p>
                </div>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="typography-ui-label font-medium text-foreground">
                            {t('settings:agents.permissions.edit', 'Edit Permission')}
                        </label>
                        <div className="flex gap-1 w-fit">
                            <Button
                                size="sm"
                                variant={editPermission === 'full' ? 'default' : 'outline'}
                                onClick={() => setEditPermission('full')}
                                className="h-6 px-2 text-xs"
                            >
                                {t('settings:agents.permissions.modes.full', 'Full')}
                            </Button>
                            <Button
                                size="sm"
                                variant={editPermission === 'allow' ? 'default' : 'outline'}
                                onClick={() => setEditPermission('allow')}
                                className="h-6 px-2 text-xs"
                            >
                                {t('settings:agents.permissions.modes.allow', 'Allow')}
                            </Button>
                            <Button
                                size="sm"
                                variant={editPermission === 'ask' ? 'default' : 'outline'}
                                onClick={() => setEditPermission('ask')}
                                className="h-6 px-2 text-xs"
                            >
                                {t('settings:agents.permissions.modes.ask', 'Ask')}
                            </Button>
                            <Button
                                size="sm"
                                variant={editPermission === 'deny' ? 'default' : 'outline'}
                                onClick={() => setEditPermission('deny')}
                                className="h-6 px-2 text-xs"
                            >
                                {t('settings:agents.permissions.modes.deny', 'Deny')}
                            </Button>
                        </div>
                        <div className="flex items-center gap-2">
                            <p className="typography-meta text-muted-foreground">
                                {t('settings:agents.permissions.editDescription', 'Controls file editing permissions.')}
                            </p>
                            <Tooltip delayDuration={1000}>
                                <TooltipTrigger asChild>
                                    <RiInformationLine className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent sideOffset={8} className="max-w-xs">
                                    <div className="space-y-1">
                                        <p><strong>{t('settings:agents.permissions.modes.full', 'Full')}:</strong> Auto-approves all tool requests</p>
                                        <p><strong>{t('settings:agents.permissions.modes.allow', 'Allow')}:</strong> Allows file editing with standard checks</p>
                                        <p><strong>{t('settings:agents.permissions.modes.ask', 'Ask')}:</strong> Prompts for confirmation before editing</p>
                                        <p><strong>{t('settings:agents.permissions.modes.deny', 'Deny')}:</strong> Blocks all file editing operations</p>
                                    </div>
                                </TooltipContent>
                            </Tooltip>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="typography-ui-label font-medium text-foreground">
                            {t('settings:agents.permissions.bash', 'Bash Permission')}
                        </label>
                        <div className="flex gap-1 w-fit">
                            <Button
                                size="sm"
                                variant={bashPermission === 'allow' ? 'default' : 'outline'}
                                onClick={() => setBashPermission('allow')}
                                className="h-6 px-2 text-xs"
                            >
                                {t('settings:agents.permissions.modes.allow', 'Allow')}
                            </Button>
                            <Button
                                size="sm"
                                variant={bashPermission === 'ask' ? 'default' : 'outline'}
                                onClick={() => setBashPermission('ask')}
                                className="h-6 px-2 text-xs"
                            >
                                {t('settings:agents.permissions.modes.ask', 'Ask')}
                            </Button>
                            <Button
                                size="sm"
                                variant={bashPermission === 'deny' ? 'default' : 'outline'}
                                onClick={() => setBashPermission('deny')}
                                className="h-6 px-2 text-xs"
                            >
                                {t('settings:agents.permissions.modes.deny', 'Deny')}
                            </Button>
                        </div>
                        <div className="flex items-center gap-2">
                            <p className="typography-meta text-muted-foreground">
                                {t('settings:agents.permissions.bashDescription', 'Controls shell command execution.')}
                            </p>
                            <Tooltip delayDuration={1000}>
                                <TooltipTrigger asChild>
                                    <RiInformationLine className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent sideOffset={8} className="max-w-xs">
                                    <div className="space-y-1">
                                        <p><strong>{t('settings:agents.permissions.modes.allow', 'Allow')}:</strong> Run bash commands without confirmation</p>
                                        <p><strong>{t('settings:agents.permissions.modes.ask', 'Ask')}:</strong> Prompt for confirmation before execution</p>
                                        <p><strong>{t('settings:agents.permissions.modes.deny', 'Deny')}:</strong> Block all bash command execution</p>
                                    </div>
                                </TooltipContent>
                            </Tooltip>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="typography-ui-label font-medium text-foreground">
                            {t('settings:agents.permissions.webfetch', 'WebFetch Permission')}
                        </label>
                        <div className="flex gap-1 w-fit">
                            <Button
                                size="sm"
                                variant={webfetchPermission === 'allow' ? 'default' : 'outline'}
                                onClick={() => setWebfetchPermission('allow')}
                                className="h-6 px-2 text-xs"
                            >
                                {t('settings:agents.permissions.modes.allow', 'Allow')}
                            </Button>
                            <Button
                                size="sm"
                                variant={webfetchPermission === 'ask' ? 'default' : 'outline'}
                                onClick={() => setWebfetchPermission('ask')}
                                className="h-6 px-2 text-xs"
                            >
                                {t('settings:agents.permissions.modes.ask', 'Ask')}
                            </Button>
                            <Button
                                size="sm"
                                variant={webfetchPermission === 'deny' ? 'default' : 'outline'}
                                onClick={() => setWebfetchPermission('deny')}
                                className="h-6 px-2 text-xs"
                            >
                                {t('settings:agents.permissions.modes.deny', 'Deny')}
                            </Button>
                        </div>
                        <div className="flex items-center gap-2">
                            <p className="typography-meta text-muted-foreground">
                                {t('settings:agents.permissions.webfetchDescription', 'Controls web request permissions.')}
                            </p>
                            <Tooltip delayDuration={1000}>
                                <TooltipTrigger asChild>
                                    <RiInformationLine className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent sideOffset={8} className="max-w-xs">
                                    <div className="space-y-1">
                                        <p><strong>{t('settings:agents.permissions.modes.allow', 'Allow')}:</strong> Fetch web content without confirmation</p>
                                        <p><strong>{t('settings:agents.permissions.modes.ask', 'Ask')}:</strong> Prompt for confirmation before fetching</p>
                                        <p><strong>{t('settings:agents.permissions.modes.deny', 'Deny')}:</strong> Block all web content access</p>
                                    </div>
                                </TooltipContent>
                            </Tooltip>
                        </div>
                    </div>
                </div>

                {}
                <div className="flex justify-end border-t border-border/40 pt-4">
                    <Button
                        size="sm"
                        variant="default"
                        onClick={handleSave}
                        disabled={isSaving}
                        className="gap-2 h-6 px-2 text-xs w-fit"
                    >
                        <RiSaveLine className="h-3 w-3" />
                        {isSaving ? t('common:button.saving', 'Saving...') : t('common:button.saveChanges', 'Save Changes')}
                    </Button>
                </div>
            </div>
        </ScrollableOverlay>
    );
};
