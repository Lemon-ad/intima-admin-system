import type { SlotPosition, ScheduleAssignment, Member } from "@/lib/types";
import { displayName } from "@/lib/utils";

export interface PositionWithAssignments {
  position: SlotPosition;
  members: Member[];
}

export interface PositionGroup {
  /** group_label (venue). null if not grouped. */
  label: string | null;
  /** Common previous_classroom for the group (first non-empty wins). */
  previousClassroom: string | null;
  positions: PositionWithAssignments[];
  /** If every position has the exact same single member, that member's display name. Otherwise null. */
  mergedMemberName: string | null;
  /** Same, but the member ids (for chip rendering). */
  mergedMemberIds: string[] | null;
}

export function buildPositionGroups(
  positions: SlotPosition[],
  assignments: ScheduleAssignment[],
  memberMap: Map<string, Member>,
): PositionGroup[] {
  const sorted = [...positions].sort((a, b) => a.sort_order - b.sort_order);
  const groups: PositionGroup[] = [];
  for (const p of sorted) {
    const label = (p as any).group_label || null;
    const prev = (p as any).previous_classroom || null;
    const memberIds = assignments
      .filter((a) => a.position_id === p.id)
      .map((a) => a.member_id);
    const members = memberIds
      .map((id) => memberMap.get(id))
      .filter((m): m is Member => !!m);
    const entry: PositionWithAssignments = { position: p, members };
    const last = groups[groups.length - 1];
    if (label && last && last.label === label) {
      last.positions.push(entry);
      if (!last.previousClassroom && prev) last.previousClassroom = prev;
    } else {
      groups.push({
        label,
        previousClassroom: prev,
        positions: [entry],
        mergedMemberName: null,
        mergedMemberIds: null,
      });
    }
  }
  // Compute merged member for each group (only when group has a label and >1 position)
  for (const g of groups) {
    if (!g.label || g.positions.length < 2) continue;
    const firstIds = g.positions[0].members.map((m) => m.id).sort().join("|");
    if (!firstIds) continue;
    const allSame = g.positions.every(
      (p) => p.members.map((m) => m.id).sort().join("|") === firstIds,
    );
    if (allSame) {
      g.mergedMemberIds = g.positions[0].members.map((m) => m.id);
      g.mergedMemberName = g.positions[0].members.map((m) => displayName(m)).join(", ");
    }
  }
  return groups;
}
