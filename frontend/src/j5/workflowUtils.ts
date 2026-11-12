import type { Definition, WorkflowNode } from "../types";
export function tree(config: Definition): WorkflowNode[] {
  return config.states.map(
    (s) =>
      config.state_tree?.find((n) => n.id === s) || {
        id: s,
        label: s,
        kind: s === "Closed" ? "final" : "atomic",
      },
  );
}
export function flattenNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.flatMap((n) => [n, ...flattenNodes(n.children || [])]);
}
export function changeNode(
  nodes: WorkflowNode[],
  id: string,
  change: (node: WorkflowNode) => WorkflowNode,
): WorkflowNode[] {
  return nodes.map((n) =>
    n.id === id
      ? change(n)
      : {
          ...n,
          children: n.children ? changeNode(n.children, id, change) : undefined,
        },
  );
}
export function initialLeaves(node: WorkflowNode): string[] {
  if (["atomic", "final"].includes(node.kind)) return [node.id];
  if (node.kind === "parallel")
    return (node.children || []).flatMap(initialLeaves);
  const child =
    node.children?.find((c) => c.id === node.initial) || node.children?.[0];
  return child ? initialLeaves(child) : [];
}
export function sourceActive(
  config: Definition,
  id: string,
  leaves: string[],
): boolean {
  const node = flattenNodes(tree(config)).find((n) => n.id === id);
  return !!node && flattenNodes([node]).some((n) => leaves.includes(n.id));
}
export function renameNode(
  nodes: WorkflowNode[],
  old: string,
  name: string,
): WorkflowNode[] {
  return nodes.map((n) => ({
    ...n,
    id: n.id === old ? name : n.id,
    label: n.id === old ? name : n.label,
    initial: n.initial === old ? name : n.initial,
    children: n.children ? renameNode(n.children, old, name) : undefined,
  }));
}
