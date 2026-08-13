import { FileCode2 } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import api, { type ResourceCategory, type SkillResource } from '../api';

type SkillReference = {
  id: string;
  category?: ResourceCategory;
};

type AgentAttributesViewProps = {
  attributes?: Record<string, unknown>;
};

const RESOURCE_CATEGORIES: ResourceCategory[] = [
  'red-team',
  'blue-team',
  'gray-team',
  'group-agents',
  'person-agents',
  'rule-team',
];

export default function AgentAttributesView({
  attributes,
}: AgentAttributesViewProps) {
  const { t } = useTranslation();
  const skillReference = getSkillReference(attributes);
  const skillQuery = useQuery({
    queryKey: ['cognitive-wargame', 'agent-skill', skillReference?.id],
    queryFn: () => findSkill(skillReference!),
    enabled: Boolean(skillReference),
    staleTime: 60_000,
    retry: 1,
  });
  const skill = skillQuery.data;
  const entries = Object.entries(attributes ?? {}).filter(
    ([key]) => key !== 'skill_id',
  );

  return (
    <div className="space-y-4 text-sm">
      {skillReference && (
        <div>
          <dt className="mb-1 text-text-secondary">
            {t('cognitiveWargame.agents.detail.skill', {
              defaultValue: 'Skill',
            })}
          </dt>
          <dd>
            <Link
              to={buildSkillUrl(skill ?? skillReference)}
              className="inline-flex max-w-full items-center gap-2 text-accent-primary underline underline-offset-2"
            >
              <FileCode2 className="size-4 shrink-0" />
              <span className="truncate">
                {skill?.name ?? skillReference.id}
              </span>
            </Link>
          </dd>
        </div>
      )}

      {entries.length > 0 && (
        <dl className="grid gap-3 md:grid-cols-2">
          {entries.map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="text-text-secondary">{key}</dt>
              <dd className="mt-1 break-words">
                {typeof value === 'object' && value !== null ? (
                  <pre className="overflow-auto rounded bg-bg-secondary p-2 text-xs">
                    {JSON.stringify(value, null, 2)}
                  </pre>
                ) : (
                  String(value ?? '-')
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {!skillReference && entries.length === 0 && (
        <p className="text-text-secondary">
          {t('cognitiveWargame.common.empty')}
        </p>
      )}
    </div>
  );
}

function getSkillReference(
  attributes?: Record<string, unknown>,
): SkillReference | null {
  const value = attributes?.skill_id;
  if (typeof value !== 'string' || !value.trim()) return null;
  const [categoryPart, ...idParts] = value.trim().split('/');
  if (isResourceCategory(categoryPart) && idParts.length > 0) {
    return { id: idParts.join('/'), category: categoryPart };
  }
  return { id: value.trim() };
}

function buildSkillUrl(
  skill: Pick<SkillResource, 'id'> & { category?: ResourceCategory },
) {
  const params = new URLSearchParams({
    type: 'skills',
    skill: skill.id,
  });
  if (skill.category) params.set('category', skill.category);
  return `/cognitive-wargame/resources/skills?${params.toString()}`;
}

async function findSkill(reference: SkillReference): Promise<SkillResource | null> {
  const responses = reference.category
    ? [await api.getSkills({ category: reference.category, page_size: 100 })]
    : await Promise.all(
        RESOURCE_CATEGORIES.map((category) =>
          api.getSkills({ category, page_size: 100 }),
        ),
      );
  return (
    responses
      .flatMap((response) => response.skills)
      .find(
        (skill) => skill.id === reference.id || skill.name === reference.id,
      ) ?? null
  );
}

function isResourceCategory(value?: string): value is ResourceCategory {
  return Boolean(value && RESOURCE_CATEGORIES.includes(value as ResourceCategory));
}
