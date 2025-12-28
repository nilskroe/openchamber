import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useGitIdentitiesStore, type GitIdentityProfile } from '@/stores/useGitIdentitiesStore';
import {
  RiUser3Line,
  RiSaveLine,
  RiDeleteBinLine,
  RiGitBranchLine,
  RiBriefcaseLine,
  RiHomeLine,
  RiGraduationCapLine,
  RiCodeLine,
  RiInformationLine
} from '@remixicon/react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';

const PROFILE_COLORS = [
  { key: 'keyword', labelKey: 'green', cssVar: 'var(--syntax-keyword)' },
  { key: 'error', labelKey: 'red', cssVar: 'var(--status-error)' },
  { key: 'string', labelKey: 'blue', cssVar: 'var(--syntax-string)' },
  { key: 'function', labelKey: 'yellow', cssVar: 'var(--syntax-function)' },
  { key: 'type', labelKey: 'purple', cssVar: 'var(--syntax-type)' },
];

const PROFILE_ICONS = [
  { key: 'branch', Icon: RiGitBranchLine, labelKey: 'branch' },
  { key: 'briefcase', Icon: RiBriefcaseLine, labelKey: 'work' },
  { key: 'house', Icon: RiHomeLine, labelKey: 'personal' },
  { key: 'graduation', Icon: RiGraduationCapLine, labelKey: 'globe' },
  { key: 'code', Icon: RiCodeLine, labelKey: 'star' },
];

export const GitIdentitiesPage: React.FC = () => {
  const { t } = useTranslation('settings');
  const {
    selectedProfileId,
    getProfileById,
    createProfile,
    updateProfile,
    deleteProfile,
  } = useGitIdentitiesStore();

  const selectedProfile = React.useMemo(() =>
    selectedProfileId && selectedProfileId !== 'new' ? getProfileById(selectedProfileId) : null,
    [selectedProfileId, getProfileById]
  );
  const isNewProfile = selectedProfileId === 'new';
  const isGlobalProfile = selectedProfileId === 'global';

  const [name, setName] = React.useState('');
  const [userName, setUserName] = React.useState('');
  const [userEmail, setUserEmail] = React.useState('');
  const [sshKey, setSshKey] = React.useState('');
  const [color, setColor] = React.useState('keyword');
  const [icon, setIcon] = React.useState('branch');
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    if (isNewProfile) {

      setName('');
      setUserName('');
      setUserEmail('');
      setSshKey('');
      setColor('keyword');
      setIcon('branch');
    } else if (selectedProfile) {

      setName(selectedProfile.name);
      setUserName(selectedProfile.userName);
      setUserEmail(selectedProfile.userEmail);
      setSshKey(selectedProfile.sshKey || '');
      setColor(selectedProfile.color || 'keyword');
      setIcon(selectedProfile.icon || 'branch');
    }
  }, [selectedProfile, isNewProfile, selectedProfileId]);

  const handleSave = async () => {
    if (!userName.trim() || !userEmail.trim()) {
      toast.error(t('gitIdentities.errors.requiredFields', 'User name and email are required'));
      return;
    }

    setIsSaving(true);

    try {
      const profileData: Omit<GitIdentityProfile, 'id'> & { id?: string } = {
        name: name.trim() || userName.trim(),
        userName: userName.trim(),
        userEmail: userEmail.trim(),
        sshKey: sshKey.trim() || null,
        color,
        icon,
      };

      let success: boolean;
      if (isNewProfile) {
        success = await createProfile(profileData);
      } else if (selectedProfileId) {
        success = await updateProfile(selectedProfileId, profileData);
      } else {
        return;
      }

      if (success) {
        toast.success(isNewProfile ? t('gitIdentities.success.created', 'Profile created successfully') : t('gitIdentities.success.updated', 'Profile updated successfully'));
      } else {
        toast.error(isNewProfile ? t('gitIdentities.errors.createFailed', 'Failed to create profile') : t('gitIdentities.errors.updateFailed', 'Failed to update profile'));
      }
    } catch (error) {
      console.error('Error saving profile:', error);
      toast.error(t('gitIdentities.errors.saveFailed', 'An error occurred while saving'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedProfileId || isNewProfile) return;

    if (!confirm(t('gitIdentities.deleteConfirm', 'Are you sure you want to delete this profile?'))) {
      return;
    }

    try {
      const success = await deleteProfile(selectedProfileId);
      if (success) {
        toast.success(t('gitIdentities.success.deleted', 'Profile deleted successfully'));
      } else {
        toast.error(t('gitIdentities.errors.deleteProfileFailed', 'Failed to delete profile'));
      }
    } catch (error) {
      console.error('Error deleting profile:', error);
      toast.error(t('gitIdentities.errors.deleteFailed', 'An error occurred while deleting'));
    }
  };

  const currentColorValue = React.useMemo(() => {
    const colorConfig = PROFILE_COLORS.find(c => c.key === color);
    return colorConfig?.cssVar || 'var(--syntax-keyword)';
  }, [color]);

  if (!selectedProfileId) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <RiUser3Line className="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p className="typography-body">{t('gitIdentities.selectFromSidebar', 'Select a profile from the sidebar')}</p>
          <p className="typography-meta mt-1 opacity-75">{t('gitIdentities.orCreateNew', 'or create a new one')}</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollableOverlay outerClassName="h-full" className="mx-auto max-w-3xl space-y-6 p-6">
        {}
        <div className="space-y-1">
          <h1 className="typography-ui-header font-semibold text-lg">
            {isNewProfile ? t('gitIdentities.newProfile', 'New Git Profile') : isGlobalProfile ? t('gitIdentities.globalIdentity', 'Global Identity') : name || t('gitIdentities.edit', 'Edit identity')}
          </h1>
          <p className="typography-body text-muted-foreground mt-1">
            {isNewProfile
              ? t('gitIdentities.description', 'Manage Git user profiles')
              : isGlobalProfile
              ? t('gitIdentities.sections.globalDesc', 'System-wide Git identity from global configuration (read-only)')
              : t('gitIdentities.sections.gitConfigDesc', 'Git user settings for commits')}
          </p>
        </div>

        {}
        {!isGlobalProfile && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="typography-ui-header font-semibold text-foreground">{t('gitIdentities.sections.profileInfo', 'Profile Information')}</h2>
            <p className="typography-meta text-muted-foreground/80">
              {t('gitIdentities.sections.profileInfoDesc', 'Basic profile settings and visual customization')}
            </p>
          </div>

          <div className="space-y-2">
            <label className="typography-ui-label font-medium text-foreground">
              {t('gitIdentities.fields.displayName', 'Display Name')}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('gitIdentities.fields.displayNamePlaceholder', 'Work Profile, Personal, etc.')}
            />
            <p className="typography-meta text-muted-foreground">
              {t('gitIdentities.fields.displayNameHint', 'Friendly name to identify this profile in the sidebar')}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="typography-ui-label font-medium text-foreground">
                {t('gitIdentities.fields.color', 'Color')}
              </label>
              <div className="flex gap-2 flex-wrap">
                {PROFILE_COLORS.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setColor(c.key)}
                    className={cn(
                      'w-8 h-8 rounded-lg border-2 transition-all',
                      color === c.key
                        ? 'border-foreground scale-110'
                        : 'border-transparent hover:border-border'
                    )}
                    style={{ backgroundColor: c.cssVar }}
                    title={t(`gitIdentities.colors.${c.labelKey}`, c.labelKey)}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="typography-ui-label font-medium text-foreground">
                {t('gitIdentities.fields.icon', 'Icon')}
              </label>
              <div className="flex gap-2 flex-wrap">
                {PROFILE_ICONS.map((i) => {
                  const IconComponent = i.Icon;
                  return (
                    <button
                      key={i.key}
                      onClick={() => setIcon(i.key)}
                      className={cn(
                        'w-8 h-8 rounded-lg border-2 transition-all flex items-center justify-center',
                        icon === i.key
                          ? 'border-primary bg-accent scale-110'
                          : 'border-border hover:border-primary/50'
                      )}
                      title={t(`gitIdentities.icons.${i.labelKey}`, i.labelKey)}
                    >
                      <IconComponent
                        className="w-4 h-4"

                        style={{ color: currentColorValue }}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        )}

        {}
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="typography-h2 font-semibold text-foreground">{t('gitIdentities.sections.gitConfig', 'Git Configuration')}</h2>
            <p className="typography-meta text-muted-foreground/80">
              {t('gitIdentities.sections.gitConfigDesc', 'Git user settings for commits')}
            </p>
          </div>

            <div className="space-y-2">
              <label className="typography-ui-label font-medium text-foreground flex items-center gap-2">
                {t('gitIdentities.fields.userName', 'User Name')} {!isGlobalProfile && <span className="text-destructive">*</span>}
                <Tooltip delayDuration={1000}>
                  <TooltipTrigger asChild>
                    <RiInformationLine className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent sideOffset={8} className="max-w-xs">
                    {t('gitIdentities.tooltips.userName', 'The name that appears in commit author information (git config user.name)')}
                  </TooltipContent>
                </Tooltip>
              </label>
            <Input
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="John Doe"
              required={!isGlobalProfile}
              readOnly={isGlobalProfile}
              disabled={isGlobalProfile}
            />
            <p className="typography-meta text-muted-foreground">
              {t('gitIdentities.fields.userNameHint', 'Git user.name configuration value')}
            </p>
          </div>

            <div className="space-y-2">
              <label className="typography-ui-label font-medium text-foreground flex items-center gap-2">
                {t('gitIdentities.fields.userEmail', 'User Email')} {!isGlobalProfile && <span className="text-destructive">*</span>}
                <Tooltip delayDuration={1000}>
                  <TooltipTrigger asChild>
                    <RiInformationLine className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent sideOffset={8} className="max-w-xs">
                    {t('gitIdentities.tooltips.userEmail', 'The email that appears in commit author information (git config user.email)')}
                  </TooltipContent>
                </Tooltip>
              </label>
            <Input
              type="email"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
              placeholder="john@example.com"
              required={!isGlobalProfile}
              readOnly={isGlobalProfile}
              disabled={isGlobalProfile}
            />
            <p className="typography-meta text-muted-foreground">
              {t('gitIdentities.fields.userEmailHint', 'Git user.email configuration value')}
            </p>
          </div>

            <div className="space-y-2">
              <label className="typography-ui-label font-medium text-foreground flex items-center gap-2">
                {t('gitIdentities.fields.sshKey', 'SSH Key Path')}
                <Tooltip delayDuration={1000}>
                  <TooltipTrigger asChild>
                    <RiInformationLine className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent sideOffset={8} className="max-w-xs">
                    {t('gitIdentities.tooltips.sshKey', 'Optional path to a specific SSH private key to use with this identity')}
                  </TooltipContent>
                </Tooltip>
              </label>
            <Input
              value={sshKey}
              onChange={(e) => setSshKey(e.target.value)}
              placeholder="/Users/username/.ssh/id_rsa"
              readOnly={isGlobalProfile}
              disabled={isGlobalProfile}
            />
            <p className="typography-meta text-muted-foreground">
              {t('gitIdentities.fields.sshKeyHint', 'Path to SSH private key for authentication (optional)')}
            </p>
          </div>

        {}
        {!isGlobalProfile && (
        <div className="flex justify-between border-t border-border/40 pt-4">
          {!isNewProfile && (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleDelete}
              className="gap-2 h-6 px-2 text-xs"
            >
              <RiDeleteBinLine className="h-3 w-3" />
              {t('gitIdentities.deleteProfile', 'Delete Profile')}
            </Button>
          )}
          <div className={cn('flex gap-2', isNewProfile && 'ml-auto')}>
            <Button
              size="sm"
              variant="default"
              onClick={handleSave}
              disabled={isSaving}
              className="gap-2 h-6 px-2 text-xs"
            >
              <RiSaveLine className="h-3 w-3" />
              {isSaving ? t('common:button.saving', 'Saving...') : t('gitIdentities.saveProfile', 'Save Profile')}
            </Button>
          </div>
        </div>
        )}
      </div>
    </ScrollableOverlay>
  );
};
