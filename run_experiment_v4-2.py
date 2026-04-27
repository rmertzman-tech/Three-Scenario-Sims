import random, math, json

# ── PARAMETERS ──────────────────────────────────────────────────────────
PC = dict(
    lam=0.12, mu=0.18, rho=0.08,
    cobs=0.018, creint=0.10, crepair=0.055,
    cCL=0.06, repairRecovery=0.022,
    alphaKS=0.012, betaKD=0.06, gammaKU=0.18,
    gammaCL=0.08,
    deltaK=0.032, deltaForced=0.055,
    maxS=3.0, maxK=3.0, maxCL=2.0,
    worldBias=0.50, repairAccess=0.50, conformity=0.65,
    n=48, k=4, steps=50
)

def cl(v, a, b): return max(a, min(b, v))
def mean(lst): return sum(lst)/len(lst) if lst else 0.0

def nu_eff(U):
    if 0.25 <= U <= 0.65: return -0.02
    return 0.10 if U < 0.25 else 0.12

def u_pen(U): return max(0, 0.25-U) + max(0, U-0.65)

def seeded_rng(seed):
    r = random.Random(seed)
    return r.random

# ── AGENT + EDGE ──────────────────────────────────────────────────────────
def make_agents(n, k, rng):
    per = math.ceil(n/k)
    agents = []
    for i in range(n):
        cluster = min(k-1, i//per)
        nat = 'AB' if cluster % 2 == 0 else 'BA'
        agents.append(dict(
            id=i, cluster=cluster, F=nat, natural=nat,
            C=1.0, S=0.0, U=0.5, P=0.5, Kd=0.0, CL=0.0,
            openness=0.30+rng()*0.50,
            influence=0.20+rng()*0.80,
            D=0.0, De=0.0, I=0.0,
            repair=False, forced=False, repairFrac=0.0
        ))
    return agents

def make_edges(agents, n, k, cluster_strength, repair_access, rng):
    edges = []
    seen = set()
    for i in range(n):
        desired = 3 + int(rng()*3)
        added = set()
        attempts = 0
        while len(added) < desired and attempts < 30:
            attempts += 1
            same = rng() < cluster_strength
            if same:
                pool = [a for a in agents if a['id'] != i and a['id'] not in added
                        and a['cluster'] == agents[i]['cluster']]
            else:
                pool = [a for a in agents if a['id'] != i and a['id'] not in added
                        and a['cluster'] != agents[i]['cluster']]
            if not pool: continue
            tgt = pool[int(rng()*len(pool))]
            key = (min(i, tgt['id']), max(i, tgt['id']))
            if key not in seen:
                seen.add(key)
                edges.append(dict(
                    a=i, b=tgt['id'],
                    w=0.5+rng()*0.5,
                    trust=0.4+rng()*0.6,
                    repair=rng() < repair_access
                ))
                added.add(tgt['id'])
    return edges

def neighbors(agent_id, edges, agents):
    ns = []
    for e in edges:
        if e['a'] == agent_id:
            ns.append((e, agents[e['b']]))
        elif e['b'] == agent_id:
            ns.append((e, agents[e['a']]))
    return ns

def dominant_frame(agent_id, edges, agents):
    ns = neighbors(agent_id, edges, agents)
    ab, ba = 0.0, 0.0
    for e, nb in ns:
        w = e['w'] * e['trust'] * nb['influence']
        if nb['F'] == 'AB': ab += w
        else: ba += w
    return 'AB' if ab >= ba else 'BA'

def polarization(agents, edges):
    within, between = [], []
    for e in edges:
        a, b = agents[e['a']], agents[e['b']]
        same = 1.0 if a['F'] == b['F'] else 0.0
        if a['cluster'] == b['cluster']:
            within.append(same)
        else:
            between.append(1.0 - same)
    return cl(mean(within) * mean(between), 0, 1)

def snapshot(agents, edges, t):
    C = mean([a['C'] for a in agents])
    S = mean([a['S'] for a in agents])
    K = mean([a['Kd'] for a in agents])
    CL = mean([a['CL'] for a in agents])
    D = mean([a['D'] for a in agents])
    Pr = mean([a['P'] for a in agents])
    U = mean([a['U'] for a in agents])
    pol = polarization(agents, edges)
    lock = cl(1.0 - U, 0, 1)
    X = cl(0.22*(1-C) + 0.20*min(1,S) + 0.18*D + 0.15*(1-Pr) + 0.12*pol + 0.13*lock, 0, 1)
    return dict(t=t, C=C, S=S, K=K, CL=CL, D=D, Pr=Pr, U=U, pol=pol, X=X)

def step(agents, edges, condition, t, steps_total, rng, params):
    world = 'AB' if rng() < params['worldBias'] else 'BA'
    false_phase = (condition == 'false') and (t > int(steps_total * 0.15))

    for a in agents:
        a['repair'] = False; a['forced'] = False; a['repairFrac'] = 0.0
        match = (a['F'] == world)
        a['I'] = (1.0 - a['S']*0.08) if match else (-0.16*(1 + a['U']*0.3))

    for a in agents:
        ns = neighbors(a['id'], edges, agents)
        s, ws = 0.0, 0.0
        for e, nb in ns:
            diff = 0.0 if a['F'] == nb['F'] else 1.0
            s += diff * e['w'] * e['trust']
            ws += e['w'] * e['trust']
        a['D'] = s/ws if ws else 0.0
        a['De'] = a['D']

    for a in agents:
        if condition == 'none':
            a['De'] = 0.0
            a['U'] = cl(a['U'] - 0.012, 0.06, 0.9)
        elif condition == 'comm':
            a['De'] = a['D']
        elif condition == 'repair':
            ns = neighbors(a['id'], edges, agents)
            rep_edges = sum(1 for e, _ in ns if e['repair'])
            access = rep_edges / len(ns) if ns else 0.0
            if access > 0.20 and a['P'] > 0.20:
                a['repair'] = True
                a['repairFrac'] = access
                if a['U'] < 0.25:   a['U'] = cl(a['U']+0.045, 0, 1)
                elif a['U'] > 0.65: a['U'] = cl(a['U']-0.045, 0, 1)
                else:               a['U'] = cl(a['U']+0.010, 0, 1)
                a['De'] = a['D'] * (1 - 0.62*access)
                if rng() < 0.03*access and a['D'] > 0.3:
                    a['F'] = dominant_frame(a['id'], edges, agents)
        elif condition == 'preloc':
            ns = neighbors(a['id'], edges, agents)
            pressure = params['conformity'] * mean([nb['influence'] for _, nb in ns]) if ns else 0.0
            dom = dominant_frame(a['id'], edges, agents)
            if pressure > a['openness'] and dom != a['F']:
                a['F'] = dom; a['U'] = cl(a['U']-0.18, 0.05, 1); a['forced'] = True
            a['De'] = a['D'] * 0.3
        elif condition == 'false':
            if false_phase and a['F'] != 'AB':
                a['F'] = 'AB'; a['forced'] = True; a['U'] = cl(a['U']-0.12, 0.05, 1)
            a['De'] = a['D'] * 0.2

    for a in agents:
        adopted = (a['F'] != a['natural'])
        adopted_contradicted = (world != a['F'])
        if adopted and adopted_contradicted:
            a['CL'] = cl(a['CL'] + params['cCL'], 0, params['maxCL'])
        else:
            a['CL'] = cl(a['CL'] - 0.005, 0, params['maxCL'])

    for a in agents:
        kd = (params['alphaKS']*a['S'] + params['betaKD']*a['De'] +
              params['gammaKU']*u_pen(a['U']) + params['gammaCL']*a['CL'])
        k_rec = params.get('r_K', 0.0) * a['Kd'] * a['repairFrac']
        a['Kd'] = cl(a['Kd'] + kd - k_rec, 0, params['maxK'])

    for a in agents:
        n_eff = nu_eff(a['U'])
        d = params['deltaForced'] if a['forced'] else params['deltaK']
        a['C'] = cl(a['C'] + params['lam']*a['I'] - params['mu']*a['De']
                    - n_eff*a['U'] - params['rho']*a['S'] - d*a['Kd'], 0, 1.5)
        scar = (params['cobs'] + params['creint']*a['De']
                + (params['crepair']-params['repairRecovery'] if a['repair'] else 0)
                + (0.07 if a['forced'] else 0))
        s_rec = params.get('r_S', 0.0) * a['S'] * a['repairFrac']
        a['S'] = cl(a['S'] + scar - s_rec, 0, params['maxS'])
        a['P'] = cl(1.0 - 0.25*a['S'] - 0.12*a['Kd'], 0.05, 1.0)

def run_simulation(condition, cluster_strength, seed=42, overrides=None,
                   intervention_step=None, intervention_overrides=None):
    """
    Run one simulation. Returns (hist, agents, edges).

    Parameters:
      condition             : 'none'|'comm'|'repair'|'preloc'|'false'
      cluster_strength      : 0.0–1.0
      seed                  : int (for reproducibility)
      overrides             : dict of PC parameter overrides for Phase 1
      intervention_step     : int or None. If set, applies intervention_overrides
                              at this step (two-phase protocol). Before this step
                              the simulation runs with base overrides only.
                              If None, behavior is identical to prior versions.
      intervention_overrides: dict of parameter overrides applied from
                              intervention_step onward. Typically includes
                              r_S, r_K, and optionally repairAccess.
    """
    rng = seeded_rng(seed)
    params = dict(PC)
    params['clusterStrength'] = cluster_strength
    if overrides:
        params.update(overrides)

    # Store Phase 1 params; Phase 2 params built at intervention_step
    phase1_params = dict(params)
    phase2_params = None
    if intervention_step is not None and intervention_overrides:
        phase2_params = dict(params)
        phase2_params.update(intervention_overrides)

    agents = make_agents(params['n'], params['k'], rng)
    edges = make_edges(agents, params['n'], params['k'],
                       cluster_strength, params['repairAccess'], rng)
    hist = [snapshot(agents, edges, 0)]

    for t in range(1, params['steps']+1):
        # Switch to phase 2 params at intervention_step
        if phase2_params is not None and t == intervention_step:
            params = phase2_params
            # Rewire repair edges if repairAccess changed
            new_ra = intervention_overrides.get('repairAccess')
            if new_ra is not None and new_ra != phase1_params.get('repairAccess', PC['repairAccess']):
                rng2 = seeded_rng(seed + 9999)
                for e in edges:
                    e['repair'] = rng2() < new_ra

        step(agents, edges, condition, t, params['steps'], rng, params)
        hist.append(snapshot(agents, edges, t))

    return hist, agents, edges

# ── EXAMPLE: RUN THE TOPOLOGY × CONDITION EXPERIMENT ──────────────────────
if __name__ == '__main__':
    CONDITIONS = ['preloc', 'false', 'repair']
    TOPOLOGIES = [('low', 0.35), ('high', 0.85)]
    RESULTS = {}

    for cond in CONDITIONS:
        for topo_name, cs in TOPOLOGIES:
            key = f"{cond}_{topo_name}"
            hist, agents, edges = run_simulation(cond, cs)
            RESULTS[key] = hist
            print(f"Done: {key:25s}  final C={hist[-1]['C']:.3f}  K={hist[-1]['K']:.3f}  "
                  f"CL={hist[-1]['CL']:.3f}  X={hist[-1]['X']:.3f}  pol={hist[-1]['pol']:.3f}")

    print("\n\n=== DETAILED RESULTS TABLE ===")
    print(f"{'Condition':<12} {'Topology':<8} {'C@10':>6} {'C@25':>6} {'C@50':>6} "
          f"{'K@10':>6} {'K@25':>6} {'K@50':>6} {'CL@10':>6} {'CL@50':>6} "
          f"{'D@50':>6} {'X@50':>6} {'pol@50':>7}")
    print("-"*105)
    for cond in CONDITIONS:
        for topo_name, cs in TOPOLOGIES:
            key = f"{cond}_{topo_name}"
            h = RESULTS[key]
            print(f"{cond:<12} {topo_name:<8} "
                  f"{h[10]['C']:>6.3f} {h[25]['C']:>6.3f} {h[50]['C']:>6.3f} "
                  f"{h[10]['K']:>6.3f} {h[25]['K']:>6.3f} {h[50]['K']:>6.3f} "
                  f"{h[10]['CL']:>6.3f} {h[50]['CL']:>6.3f} "
                  f"{h[50]['D']:>6.3f} {h[50]['X']:>6.3f} {h[50]['pol']:>7.3f}")

    with open('/tmp/experiment_results.json', 'w') as f:
        json.dump(RESULTS, f)
    print("\n\nResults saved to /tmp/experiment_results.json")
