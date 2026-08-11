import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { ResourceCategory, SkillResource } from '../api';
import api from '../api';

const RESOURCE_CATEGORIES: ResourceCategory[] = [
  'red-team',
  'blue-team',
  'gray-team',
  'group-agents',
  'person-agents',
  'rule-team',
];

const SKILL_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

interface SkillEditDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  category?: ResourceCategory;
  skill?: SkillResource | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SkillEditDialog({
  open,
  mode,
  category,
  skill,
  onClose,
  onSuccess,
}: SkillEditDialogProps) {
  const { t } = useTranslation();
  const [category_, setCategory] = useState<ResourceCategory>(
    category ?? 'blue-team',
  );
  const [skillId, setSkillId] = useState('');
  const [skillMd, setSkillMd] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCreate = mode === 'create';

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    if (isCreate) {
      setCategory(category ?? 'blue-team');
      setSkillId('');
      setSkillMd('');
    } else if (skill) {
      setCategory(skill.category);
      setSkillId(skill.id);
      // Fetch existing SKILL.md content
      api
        .getSkillFileContent(skill.category, skill.id, 'SKILL.md')
        .then((content) => setSkillMd(content))
        .catch(() => setSkillMd(''));
    }
  }, [open, isCreate, skill, category]);

  const title = useMemo(() => {
    return isCreate
      ? (t('cognitiveWargame.skills.editDialog.createTitle', {
          defaultValue: 'New Skill',
        }) as string)
      : (t('cognitiveWargame.skills.editDialog.editTitle', {
          defaultValue: 'Edit Skill',
        }) as string);
  }, [isCreate, t]);

  const handleSave = async () => {
    setError(null);

    if (isCreate) {
      if (!skillId.trim()) {
        setError(
          t('cognitiveWargame.skills.editDialog.skillIdRequired', {
            defaultValue: 'Skill ID is required',
          }) as string,
        );
        return;
      }
      if (!SKILL_ID_RE.test(skillId.trim())) {
        setError(
          t('cognitiveWargame.skills.editDialog.skillIdFormat', {
            defaultValue: 'Skill ID must match [a-z0-9][a-z0-9_-]*',
          }) as string,
        );
        return;
      }
    }

    if (!skillMd.trim()) {
      setError(
        t('cognitiveWargame.skills.editDialog.contentRequired', {
          defaultValue: 'SKILL.md content is required',
        }) as string,
      );
      return;
    }

    setSaving(true);
    try {
      if (isCreate) {
        await api.createSkill(category_, skillId.trim(), skillMd);
      } else {
        await api.updateSkillMd(category_, skillId, skillMd);
      }
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : (t('cognitiveWargame.skills.editDialog.saveFailed', {
              defaultValue: 'Save failed',
            }) as string);
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {isCreate && (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-text-secondary">
                {t('cognitiveWargame.skills.editDialog.category', {
                  defaultValue: 'Category',
                })}
              </label>
              <Select
                value={category_}
                onValueChange={(v) => setCategory(v as ResourceCategory)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESOURCE_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-text-secondary">
                {t('cognitiveWargame.skills.editDialog.skillId', {
                  defaultValue: 'Skill ID',
                })}
              </label>
              <Input
                value={skillId}
                onChange={(e) => setSkillId(e.target.value)}
                placeholder={t('cognitiveWargame.skills.editDialog.skillIdPlaceholder', {
                  defaultValue: 'e.g. blue-strategist',
                }) as string}
              />
            </div>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm text-text-secondary">
            SKILL.md
          </label>
          <Textarea
            value={skillMd}
            onChange={(e) => setSkillMd(e.target.value)}
            className="min-h-60 font-mono text-xs"
            placeholder={t('cognitiveWargame.skills.editDialog.contentPlaceholder', {
              defaultValue: 'YAML frontmatter + Markdown body',
            }) as string}
          />
        </div>

        {error && <p className="text-sm text-state-error">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} loading={saving}>
            {t('common.save', { defaultValue: 'Save' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
