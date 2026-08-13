import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileCode2, Plus, X } from 'lucide-react';
import { Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { RequireRole } from './require-role';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ResourceCategory } from '../api';
import api from '../api';

const RESOURCE_CATEGORIES: ResourceCategory[] = [
  'red-team',
  'blue-team',
  'gray-team',
  'group-agents',
  'person-agents',
  'rule-team',
];

interface SkillAssignPanelProps {
  agentId: string;
}

export default function SkillAssignPanel({ agentId }: SkillAssignPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [assignCategory, setAssignCategory] = useState<ResourceCategory>('blue-team');
  const [selectedSkillId, setSelectedSkillId] = useState<string>('');

  const assignedQuery = useQuery({
    queryKey: ['cognitive-wargame', 'agent-skills', agentId],
    queryFn: () => api.getAgentSkills(agentId),
    staleTime: 30_000,
  });

  const skillsQuery = useQuery({
    queryKey: ['cognitive-wargame', 'skills-list', assignCategory],
    queryFn: () => api.getSkills({ category: assignCategory, page_size: 100 }),
    staleTime: 30_000,
    enabled: dialogOpen,
  });

  const unassignMutation = useMutation({
    mutationFn: ({
      category,
      skillId,
    }: {
      category: ResourceCategory;
      skillId: string;
    }) => api.unassignAgentSkill(agentId, category, skillId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['cognitive-wargame', 'agent-skills', agentId],
      });
    },
  });

  const assignMutation = useMutation({
    mutationFn: () =>
      api.assignAgentSkills(agentId, [
        { category: assignCategory, skill_id: selectedSkillId },
      ]),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['cognitive-wargame', 'agent-skills', agentId],
      });
      setDialogOpen(false);
      setSelectedSkillId('');
    },
  });

  const assignedSkills = assignedQuery.data?.skills ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text-secondary">
          {t('cognitiveWargame.agents.detail.assignedSkills', {
            defaultValue: 'Assigned Skills',
          })}
        </span>
        <RequireRole>
          <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
            <Plus className="size-3.5" />
            {t('cognitiveWargame.agents.detail.assignSkill', {
              defaultValue: 'Assign Skill',
            })}
          </Button>
        </RequireRole>
      </div>

      {assignedSkills.length === 0 ? (
        <p className="text-sm text-text-secondary">
          {t('cognitiveWargame.agents.detail.noSkills', {
            defaultValue: 'No skills assigned',
          })}
        </p>
      ) : (
        <ul className="space-y-2">
          {assignedSkills.map((s) => (
            <li
              key={`${s.category}/${s.skill_id}`}
              className="flex items-center justify-between rounded border border-border-button bg-bg-input/50 px-3 py-2"
            >
              <Link
                to={`/cognitive-wargame/resources/skills?type=skills&category=${s.category}&skill=${s.skill_id}`}
                className="flex min-w-0 items-center gap-2 text-accent-primary underline underline-offset-2"
              >
                <FileCode2 className="size-4 shrink-0" />
                <span className="truncate text-sm">{s.skill_name || s.skill_id}</span>
                <span className="shrink-0 text-xs text-text-secondary">
                  ({s.category})
                </span>
              </Link>
              <RequireRole>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-auto p-1 text-text-error"
                  onClick={() =>
                    unassignMutation.mutate({
                      category: s.category,
                      skillId: s.skill_id,
                    })
                  }
                >
                  <X className="size-4" />
                </Button>
              </RequireRole>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && setDialogOpen(false)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>
              {t('cognitiveWargame.agents.detail.assignSkill', {
                defaultValue: 'Assign Skill',
              })}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-text-secondary">
                {t('cognitiveWargame.skills.editDialog.category', {
                  defaultValue: 'Category',
                })}
              </label>
              <Select
                value={assignCategory}
                onValueChange={(v) => {
                  setAssignCategory(v as ResourceCategory);
                  setSelectedSkillId('');
                }}
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
                {t('cognitiveWargame.resource.name', {
                  defaultValue: 'Skill',
                })}
              </label>
              <Select
                value={selectedSkillId}
                onValueChange={setSelectedSkillId}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t('cognitiveWargame.skills.editDialog.selectSkill', {
                      defaultValue: 'Select a skill',
                    }) as string}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(skillsQuery.data?.skills ?? []).map((skill) => (
                    <SelectItem key={skill.id} value={skill.id}>
                      {skill.name || skill.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => assignMutation.mutate()}
              loading={assignMutation.isPending}
              disabled={!selectedSkillId}
            >
              {t('cognitiveWargame.agents.detail.assignSkill', {
                defaultValue: 'Assign',
              })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
