"""Hierarchical statecharts for the local emulator, including orthogonal regions."""

from copy import deepcopy
from .formulas import (
    Engine,
    Parser,
    FormulaError,
    formula_references,
    calculated_values,
)


class WorkflowError(ValueError):
    pass


def state_tree(config):
    return config.get("state_tree") or [
        {"id": s, "label": s, "kind": "final" if s == "Closed" else "atomic"}
        for s in config["states"]
    ]


def index_tree(config):
    nodes = {}
    parents = {}

    def walk(node, parent=None, depth=0):
        if (
            not isinstance(node, dict)
            or not isinstance(node.get("id"), str)
            or not node["id"].strip()
            or len(node["id"]) > 80
        ):
            raise WorkflowError("Each state needs an ID of at most 80 characters.")
        if depth > 6 or len(nodes) >= 100:
            raise WorkflowError(
                "Statecharts support up to 100 nodes and six nesting levels."
            )
        key = node["id"]
        if key in nodes:
            raise WorkflowError("State IDs must be unique across all regions.")
        nodes[key] = node
        parents[key] = parent
        children = node.get("children", [])
        if not isinstance(children, list):
            raise WorkflowError("State children must be a list.")
        for child in children:
            walk(child, key, depth + 1)

    tree = state_tree(config)
    if not isinstance(tree, list):
        raise WorkflowError("State tree must be a list.")
    for node in tree:
        walk(node)
    return nodes, parents


def ancestors(key, parents):
    chain = []
    while key is not None:
        chain.append(key)
        key = parents.get(key)
    return chain


def source_active(config, source, active):
    _, parents = index_tree(config)
    return any(source in ancestors(leaf, parents) for leaf in active)


def default_leaves(config, state="Draft"):
    nodes, _ = index_tree(config)

    def enter(key):
        n = nodes[key]
        kind = n.get("kind", "atomic")
        if kind in ["atomic", "final"]:
            return [key]
        children = n.get("children", [])
        if kind == "parallel":
            return [leaf for child in children for leaf in enter(child["id"])]
        return enter(n.get("initial") or children[0]["id"])

    return enter(state)


def active_leaves(config, root, stored=None):
    nodes, parents = index_tree(config)
    leaves = stored or default_leaves(config, root)
    if any(
        s not in nodes or nodes[s].get("kind", "atomic") not in ["atomic", "final"]
        for s in leaves
    ):
        raise WorkflowError(
            "Stored workflow state does not match its pinned definition."
        )
    if len(set(leaves)) != len(leaves) or not leaves or len(leaves) > 30:
        raise WorkflowError("Invalid active state set.")
    # Ensure exactly one child of a compound state, and every parallel region, is active.
    active_set = {p for leaf in leaves for p in ancestors(leaf, parents)}
    if {p for p in active_set if parents[p] is None} != {root}:
        raise WorkflowError(
            "Active states must belong to the current top-level status."
        )
    for key in active_set:
        node = nodes[key]
        kind = node.get("kind", "atomic")
        children = node.get("children", [])
        count = sum(ch["id"] in active_set for ch in children)
        if kind == "compound" and count != 1:
            raise WorkflowError("A compound state requires exactly one active child.")
        if kind == "parallel" and count != len(children):
            raise WorkflowError("Every parallel region requires an active state.")
    return leaves


def validate_effects(effects, config):
    fields = {f["id"] for f in config["fields"]}
    if not isinstance(effects, list) or len(effects) > 20:
        raise WorkflowError("Use at most 20 field assignment effects.")
    for effect in effects:
        if (
            not isinstance(effect, dict)
            or not isinstance(effect.get("field"), str)
            or effect["field"] not in fields
        ):
            raise WorkflowError("Effects must target a known form field.")
        if next(f for f in config["fields"] if f["id"] == effect["field"]).get(
            "formula"
        ):
            raise WorkflowError("Effects cannot assign a calculated field.")
        try:
            Parser(effect.get("formula")).parse()
        except FormulaError as e:
            raise WorkflowError(str(e)) from None


def validate_workflow(config):
    nodes, parents = index_tree(config)
    if [n["id"] for n in state_tree(config)] != config["states"]:
        raise WorkflowError("Top-level state tree order must match the status list.")
    if (
        nodes["Draft"].get("kind", "atomic") == "final"
        or nodes["Closed"].get("kind") != "final"
    ):
        raise WorkflowError(
            "Draft is an initial working state and Closed must be final."
        )
    for key, n in nodes.items():
        kind = n.get("kind", "atomic")
        children = n.get("children", [])
        if kind not in ["atomic", "compound", "parallel", "final"]:
            raise WorkflowError("Unknown state kind.")
        if not isinstance(n.get("label", key), str):
            raise WorkflowError("State labels must be text.")
        if kind in ["atomic", "final"] and children:
            raise WorkflowError("Atomic and completion states cannot have children.")
        if kind == "compound":
            if not children or n.get("initial", children[0]["id"]) not in [
                c["id"] for c in children
            ]:
                raise WorkflowError("A compound state needs a valid initial child.")
        if kind == "parallel":
            if not 2 <= len(children) <= 6 or any(
                c.get("kind") != "compound" for c in children
            ):
                raise WorkflowError("Parallel states need 2–6 compound regions.")
            for child in children:
                if not any(c.get("kind") == "final" for c in child.get("children", [])):
                    raise WorkflowError(
                        "Each parallel region needs a completion state."
                    )
        if n.get("history", "none") not in ["none", "shallow", "deep"]:
            raise WorkflowError("History must be none, shallow or deep.")
        validate_effects(n.get("entry_effects", []), config)
        validate_effects(n.get("exit_effects", []), config)
    edges = {key: set() for key in nodes}
    for key, n in nodes.items():
        children = n.get("children", [])
        if n.get("kind") == "compound":
            edges[key].add(n.get("initial") or children[0]["id"])
        if n.get("kind") == "parallel":
            edges[key].update(c["id"] for c in children)
        if n.get("kind") == "final" and parents[key]:
            edges[key].add(parents[key])
    for t in config["transitions"]:
        source, target = t["source"], t["target"]
        if source not in nodes or target not in nodes:
            raise WorkflowError("Transitions must refer to defined states.")
        if nodes[source].get("kind") == "final":
            raise WorkflowError(
                "Completion states cannot have manual outgoing transitions; connect their container."
            )
        if t.get("use_history") and nodes[target].get("kind") not in [
            "compound",
            "parallel",
        ]:
            raise WorkflowError("History targets must be compound or parallel states.")
        event = t.get("event", "manual")
        if event not in ["manual", "completion", "timer"]:
            raise WorkflowError("Supported events are manual, completion and timer.")
        if event == "timer" and (
            type(t.get("after_seconds")) is not int
            or not 1 <= t["after_seconds"] <= 31536000
        ):
            raise WorkflowError("Timer delay must be 1–31,536,000 seconds.")
        if event == "completion" and nodes[source].get("kind") not in [
            "compound",
            "parallel",
        ]:
            raise WorkflowError(
                "Completion events require a compound or parallel source."
            )
        if (
            nodes[source].get("kind") == "parallel"
            and event == "manual"
            and t.get("target") not in ancestors(source, parents)
        ):
            # Explicit parent cancellation/rejection is allowed; source/target selection remains visible.
            pass
        # Cross-region jumps break orthogonal state invariants; use the enclosing completion transition.
        for common in set(ancestors(source, parents)) & set(ancestors(target, parents)):
            if (
                nodes[common].get("kind") == "parallel"
                and source != common
                and target != common
            ):
                a = next(k for k in ancestors(source, parents) if parents[k] == common)
                b = next(k for k in ancestors(target, parents) if parents[k] == common)
                if a != b:
                    raise WorkflowError(
                        "Transitions between parallel regions are unsupported. Complete each region and use its parent completion transition."
                    )
        edges[source].add(target)
        # Parent actions are inherited by descendant states.
        for child in nodes:
            if source in ancestors(child, parents):
                edges[child].add(target)
        validate_effects(t.get("effects", []), config)
        if t.get("guard_formula"):
            try:
                Parser(t["guard_formula"]).parse()
            except FormulaError as e:
                raise WorkflowError(str(e)) from None
        if not isinstance(t.get("prompt", ""), str):
            raise WorkflowError("User prompts must be text.")
    reached = {"Draft"}
    for _ in nodes:
        reached |= {target for key in tuple(reached) for target in edges[key]}
    if reached != set(nodes):
        raise WorkflowError(
            "Every state must be reachable from Draft, including each region completion state."
        )
    close = {"Closed"}
    for _ in nodes:
        close |= {key for key in nodes if edges[key] & close}
    if close != set(nodes):
        raise WorkflowError("Every state needs an exit path to Closed.")
    # A parallel parent must use completion for normal progression, while manual parent actions can cancel.
    for key, n in nodes.items():
        if n.get("kind") == "parallel" and not any(
            t["source"] == key and t.get("event") == "completion"
            for t in config["transitions"]
        ):
            raise WorkflowError(
                "Parallel states need an automatic completion transition."
            )


def completed(key, active, nodes, parents):
    n = nodes[key]
    kind = n.get("kind", "atomic")
    if kind == "final":
        return key in active
    if kind == "atomic":
        return False
    children = n.get("children", [])
    if kind == "parallel":
        return all(completed(child["id"], active, nodes, parents) for child in children)
    return any(
        completed(child["id"], active, nodes, parents)
        for child in children
        if any(child["id"] in ancestors(s, parents) for s in active)
    )


def advance(config, root, stored, transition_id, values, context, check, after=None):
    nodes, parents = index_tree(config)
    active = list(active_leaves(config, root, stored))
    values = dict(values)
    trace = []
    effects_log = []
    memory = deepcopy(context.get("history", {}))

    def effects(items, origin):
        nonlocal values
        for effect in items:
            result = Engine(config, values, context).evaluate(effect["formula"])
            if type(result) not in [str, float, int, bool, type(None)]:
                raise WorkflowError("Effects must calculate scalar values.")
            values[effect["field"]] = result
            effects_log.append(
                {"origin": origin, "field": effect["field"], "value": result}
            )
        values = calculated_values(config, values, context)

    def enter(key, target=None, remembered=None):
        n = nodes[key]
        effects(n.get("entry_effects", []), f"Enter {key}")
        kind = n.get("kind", "atomic")
        if kind in ["atomic", "final"]:
            return [key]
        children = n["children"]
        if kind == "parallel":
            return [
                leaf
                for child in children
                for leaf in enter(
                    child["id"],
                    target
                    if target and child["id"] in ancestors(target, parents)
                    else None,
                    remembered,
                )
            ]
        if remembered:
            target = next(
                (leaf for leaf in remembered if key in ancestors(leaf, parents)), target
            )
        chosen = (
            next(
                (
                    c["id"]
                    for c in children
                    if target and c["id"] in ancestors(target, parents)
                ),
                None,
            )
            or n.get("initial")
            or children[0]["id"]
        )
        return enter(chosen, target, remembered)

    def apply(t, automatic=False):
        nonlocal active
        if not source_active(config, t["source"], active):
            raise WorkflowError("Transition source is not active.")
        check(t, values, automatic)
        src, dst = t["source"], t["target"]
        a, b = ancestors(src, parents), ancestors(dst, parents)
        common = next((k for k in a if k in b), None)
        if common in [src, dst]:
            domain = common
            entry = common
        else:
            domain = next(k for k in a if parents[k] == common)
            entry = next(k for k in b if parents[k] == common)
        removed = [leaf for leaf in active if domain in ancestors(leaf, parents)]
        remaining = [leaf for leaf in active if leaf not in removed]
        exiting = {
            key
            for leaf in removed
            for key in ancestors(leaf, parents)
            if domain in ancestors(key, parents)
        }
        saved = deepcopy(memory.get(dst, [])) if t.get("use_history") else []
        for key in exiting:
            if nodes[key].get("kind") in ["compound", "parallel"]:
                memory[key] = [
                    leaf for leaf in active if key in ancestors(leaf, parents)
                ]
        for key in sorted(
            exiting, key=lambda k: len(ancestors(k, parents)), reverse=True
        ):
            effects(nodes[key].get("exit_effects", []), f"Exit {key}")
        effects(t.get("effects", []), t["label"])
        if saved and nodes[dst].get("history") == "shallow":
            children = {
                next(k for k in ancestors(leaf, parents) if parents[k] == dst)
                for leaf in saved
                if leaf in nodes and dst in ancestors(leaf, parents)
            }
            saved = [
                leaf for child in children for leaf in default_leaves(config, child)
            ]
        if nodes[dst].get("history", "none") == "none":
            saved = []
        active = remaining + enter(entry, dst, saved)
        if after:
            after(t, values)
        trace.append(
            {
                "id": t["id"],
                "label": t["label"],
                "source": src,
                "target": dst,
                "automatic": automatic,
            }
        )

    t = next((t for t in config["transitions"] if t["id"] == transition_id), None)
    if not t or t.get("event", "manual") != context.get("event_kind", "manual"):
        raise WorkflowError("Choose an available manual transition.")
    apply(t, context.get("event_kind") == "timer")
    for _ in range(30):
        automatic = next(
            (
                t
                for t in config["transitions"]
                if t.get("event") == "completion"
                and source_active(config, t["source"], active)
                and completed(t["source"], active, nodes, parents)
            ),
            None,
        )
        if automatic is None:
            break
        apply(automatic, True)
    else:
        raise WorkflowError("Automatic transition cycle detected.")
    order = {key: i for i, key in enumerate(nodes)}
    active.sort(key=lambda s: order[s])
    current = ancestors(active[0], parents)[-1]
    active_leaves(config, current, active)
    return {
        "state": current,
        "active_states": active,
        "values": values,
        "trace": trace,
        "effects": effects_log,
        "history": memory,
    }


def initialize_workflow(config, values, context=None):
    """Enter the initial hierarchy once when a record is created."""
    nodes, parents = index_tree(config)
    leaves = default_leaves(config)
    active = {key for leaf in leaves for key in ancestors(leaf, parents)}
    values = dict(values)
    effects = []
    for key in sorted(
        active, key=lambda k: (len(ancestors(k, parents)), list(nodes).index(k))
    ):
        for effect in nodes[key].get("entry_effects", []):
            value = Engine(config, values, context).evaluate(effect["formula"])
            if type(value) not in [str, float, int, bool, type(None)]:
                raise WorkflowError("Effects must calculate scalar values.")
            values[effect["field"]] = value
            effects.append(
                {"origin": f"Enter {key}", "field": effect["field"], "value": value}
            )
    # Incomplete draft inputs may make calculated fields temporarily unevaluable.
    # Such errors remain visible in the form and block save/transition until corrected.
    engine = Engine(config, values, context)
    for field in config["fields"]:
        if field.get("formula"):
            try:
                values[field["id"]] = engine.reference(field["id"])
            except FormulaError:
                values.pop(field["id"], None)
    return {"active_states": leaves, "values": values, "effects": effects}
