# Propagation model

How SignalPlan predicts Wi-Fi signal strength, where every number comes from, and where the model is known to be wrong. The code is in [`packages/engine`](../packages/engine/src).

## The equation

The received signal strength at a point, in dBm, is

```math
P_{rx} = \mathrm{EIRP} - \left[ PL(d_0) + 10\,n\,\log_{10}\frac{d}{d_0} + \sum_i L_{wall,i} \right]
```

| Term     | Meaning                                                 | Value                                |
| -------- | ------------------------------------------------------- | ------------------------------------ |
| EIRP     | Radio's effective radiated power, antenna gain included | Per radio, or the band default below |
| PL(d₀)   | Free-space loss at the reference distance d₀ = 1 m      | From the band's midpoint frequency   |
| n        | Path loss exponent                                      | 2 (free space)                       |
| d        | Straight-line distance from access point to point       | Metres                               |
| L_wall,i | Loss of each wall the straight line crosses             | Material table below                 |

The receiver is assumed to have 0 dBi gain, which is typical of a phone.

Distance is measured in 3D, from the access point's mounting height to a receiver held **1 m above the floor**. Within 1 m of an access point the 1 m value is used, since the formula isn't meant for the near field.

## From equation to heatmap

The engine evaluates the equation at the centre of every cell in a regular grid covering the floor's walls plus a 1 m margin. The default cell size is **10 cm**. For each cell it:

1. finds every wall segment on the straight line from each access point (`crossings.ts`; a corner or door edge counts once, using the lossier material),
2. computes the predicted signal from each access point with a radio in the selected band, and
3. keeps the **strongest** one, recording which access point it came from.

The sample home's grid (204 m² including the margin, 20,400 cells) computes in about 20 ms on a laptop, so no spatial index is needed yet. A unit test fails if a 100 m² grid takes longer than 200 ms. Access points on other floors are ignored until multi-floor support in Phase 5.

This is a **multi-wall model**, as in the COST 231 final report. Because walls are counted one by one, the distance term uses the free-space exponent n = 2 rather than a larger empirical exponent that would already include walls. Calibration (Phase 7) may adjust n and the wall losses to fit real measurements.

## Bands

North American channel ranges. The reference loss is free-space loss at 1 m, computed at the band's midpoint (`freeSpacePathLoss` in [`pathLoss.ts`](../packages/engine/src/pathLoss.ts)).

| Band    | Channels (GHz)             | Midpoint (GHz) | PL(1 m) | Default EIRP | Regulatory limit (FCC / ISED)          |
| ------- | -------------------------- | -------------- | ------- | ------------ | -------------------------------------- |
| 2.4 GHz | 2.401–2.473 (ch. 1–11)     | 2.437          | 40.2 dB | 20 dBm       | 36 dBm EIRP (47 CFR § 15.247)          |
| 5 GHz   | 5.150–5.895 (U-NII-1 to 4) | 5.523          | 47.3 dB | 23 dBm       | Set per U-NII sub-band (§ 15.407)      |
| 6 GHz   | 5.925–7.125 (U-NII-5 to 8) | 6.525          | 48.7 dB | 18 dBm       | Low-power indoor: 5 dBm/MHz (§ 15.407) |

The 2.4 and 5 GHz defaults are **assumptions**: typical consumer router output, well below the legal limits. The 6 GHz default is the low-power indoor limit applied to a 20 MHz channel, which is what beacons (and so a phone's signal reading) use. Users can set any radio's EIRP in the plan.

## Wall materials

### Method

Each wall material stands for a typical **North American construction**, built up in layers. Losses are calculated, not looked up:

1. **Electrical properties** of each layer come from Recommendation **ITU-R P.2040-4** (09/2025), Table 3: relative permittivity ε′ = a·f^b and conductivity σ = c·f^d (eqs. 57–58, f in GHz), with ε″ = 17.98·σ/f (eq. 59).
2. **Transmission through the layered wall** uses P.2040's general multi-layer slab method (§ 2.2.2.1, eqs. 39–42), which accounts for reflections at every surface, and for absorption and interference inside each layer.
3. The result is the mean of TE and TM polarisation (a phone's orientation is random) at normal incidence, **averaged over 25 frequencies across the band**. Averaging smooths out thickness resonances that make single-frequency results jump by several dB.

### Constructions

| Material      | Construction                             | Layers (P.2040 class)                                                                                 |
| ------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `drywall`     | Interior stud wall                       | 12.7 mm plasterboard · 89 mm air · 12.7 mm plasterboard                                               |
| `brick`       | Exterior brick veneer wall               | 90 mm brick · 25 mm air · 11 mm OSB (chipboard) · 89 mm insulated cavity (air) · 12.7 mm plasterboard |
| `concrete`    | Poured concrete, such as a basement wall | 200 mm concrete                                                                                       |
| `glass`       | Double-glazed window                     | 3 mm glass · 13 mm air · 3 mm glass                                                                   |
| `low-e-glass` | Double-glazed low-E window               | As `glass`, plus a metallic coating (see below)                                                       |
| `wood`        | Solid-core door                          | 44 mm wood                                                                                            |
| `metal`       | Steel door or appliance                  | 1 mm metal, capped at 40 dB                                                                           |

Fibreglass insulation is modelled as air; its permittivity is close to 1.

**Low-E glass.** P.2040 has no data for the metal-oxide coatings on energy-efficient windows, which block much more signal than plain glass. The coating is modelled as a 100 nm conductive film with sheet resistance R_s. R_s is the only fitted number in the model: it is chosen so the model matches the **29.7 dB** measured through a double-pane low-E window at 6.75 GHz by Shakya et al. (see sources). The fitted value, **9.1 Ω/sq**, falls within the range commonly quoted for real low-E coatings (roughly 2–20 Ω/sq), which suggests the film model is physically sensible.

**Metal.** P.2040 treats metal as a near-perfect conductor, which gives thousands of dB of loss. Real signals leak around the edges of doors, appliances and ducts, so metal is **capped at 40 dB**, slightly below the 43.2 dB measured through a steel door (Shakya et al.).

### Loss per wall crossing (dB)

| Material      | 2.4 GHz | 5 GHz | 6 GHz |
| ------------- | ------- | ----- | ----- |
| `drywall`     | 2.9     | 2.4   | 1.4   |
| `brick`       | 5.8     | 5.3   | 5.2   |
| `concrete`    | 14.7    | 26.5  | 29.9  |
| `glass`       | 0.5     | 6.1   | 8.3   |
| `low-e-glass` | 23.5    | 29.9  | 29.8  |
| `wood`        | 0.7     | 1.8   | 2.1   |
| `metal`       | 40      | 40    | 40    |

These values are pinned by a unit test (`materials.test.ts`), so this table and the code change together.

Two results may look odd but follow from the physics. The stud wall loses **less** at 6 GHz than at 2.4 GHz because the two gypsum sheets interfere constructively in that band. Glass is almost transparent at 2.4 GHz because 3 mm panes are tiny compared with the 12 cm wavelength.

## Validation

The model is compared with co-polarised penetration loss measured at 6.75 GHz by Shakya et al., using each sample's actual thickness. Only the low-E coating was fitted; everything else is predicted from P.2040.

| Sample                       | Measured (dB) | Model (dB) | Difference |
| ---------------------------- | ------------- | ---------- | ---------- |
| Low-E window, 20 mm (fitted) | 29.7          | 29.7       | 0.0        |
| Wooden door, 45 mm           | 5.8           | 2.0        | −3.8       |
| Clear glass, 10 mm           | 3.6           | 1.1        | −2.5       |
| Drywall panel, 30 mm         | 0.6           | 2.1        | +1.5       |
| Plasterboard wall, 137 mm    | 2.1           | 1.5        | −0.6       |
| Steel door, 47 mm (capped)   | 43.2          | 40.0       | −3.2       |

The model is within 4 dB on every sample, but it **under-predicts wood and glass**. The measured door was a fire-rated solid-wood-core door, which is probably denser and lossier than the wood samples behind P.2040's wood class. A unit test keeps every sample within 4 dB so that later changes can't make the model silently worse. Measurements at 2.4 and 5 GHz, and in real homes (Phase 7), are needed before these numbers can be trusted in those bands.

### Against the ITU-R P.1238-13 indoor model

Recommendation ITU-R P.1238-13 gives an empirical site-general model for indoor path loss: L_b = 10α·log10(d) + β + 10γ·log10(f), with d in metres and f in GHz (eq. 1). It no longer publishes separate residential coefficients and advises using office values for homes. The office, no-line-of-sight coefficients (Table 2: α = 2.39, β = 30.13, γ = 2.40, σ = 5.01 dB) fold typical walls and clutter into the distance term.

Path loss in dB (lower is stronger), comparing that median with this model's free-space term plus one or two `drywall` walls:

| Band    | Distance | Free space | Model, 1 wall | Model, 2 walls | P.1238-13 office NLoS |
| ------- | -------- | ---------- | ------------- | -------------- | --------------------- |
| 2.4 GHz | 5 m      | 54.2       | 57.1          | 60.0           | 56.1                  |
| 2.4 GHz | 10 m     | 60.2       | 63.1          | 66.0           | 63.3                  |
| 2.4 GHz | 20 m     | 66.2       | 69.1          | 72.0           | 70.5                  |
| 5 GHz   | 5 m      | 61.3       | 63.7          | 66.1           | 64.6                  |
| 5 GHz   | 10 m     | 67.3       | 69.7          | 72.1           | 71.8                  |
| 5 GHz   | 20 m     | 73.3       | 75.7          | 78.1           | 79.0                  |

With the one or two interior walls a path typically crosses at these distances, the model sits within about 3 dB of the P.1238-13 median, well inside that model's 5 dB spread. The model therefore uses the free-space exponent n = 2 without an extra clutter term.

## Known limits

- **Straight line only.** Signals that bend around corners (diffraction) or bounce off walls (reflection) are ignored, so areas behind strong walls are predicted darker than they are.
- **Normal incidence.** Wall loss is computed for a wave meeting the wall head on. Real loss grows at shallow angles; the slab code supports angles, and using them is a possible refinement.
- **Omnidirectional access points.** Antenna patterns are ignored.
- **Typical constructions.** A real wall may differ from its construction above: metal studs, foil-backed insulation, tile or plaster lath all add loss.
- **No furniture, people or neighbouring networks.**
- **Receiver losses aren't modelled.** A phone's antenna is less efficient than the 0 dBi assumed, and a hand or body near it absorbs signal, so a phone may read several dB below the prediction.
- **Uncalibrated.** Until Phase 7, predictions have not been checked against measurements in a real home.

## Sources

- Recommendation ITU-R P.1238-13 (09/2025), _Propagation data and prediction methods for the planning of indoor radiocommunication systems and radio local area networks in the frequency range from 300 MHz to 450 GHz_. International Telecommunication Union. Eq. 1, Table 2.
- Recommendation ITU-R P.2040-4 (09/2025), _Effects of building materials and structures on radiowave propagation above about 100 MHz_. International Telecommunication Union. Table 3; eqs. 27a, 39–44, 57–59.
- D. Shakya, M. Ying, T. S. Rappaport, H. Poddar, P. Ma, Y. Wang and I. Al-Wazani, "Wideband Penetration Loss through Building Materials and Partitions at 6.75 GHz in FR1(C) and 16.95 GHz in the FR3 Upper Mid-band spectrum", IEEE GLOBECOM 2024. [arXiv:2405.01362](https://arxiv.org/abs/2405.01362). Table II.
- COST Action 231, _Digital mobile radio towards future generation systems: final report_, European Commission, 1999. Indoor multi-wall model.
- 47 CFR §§ 15.247 and 15.407 (FCC Part 15), and the matching ISED rules RSS-247 and RSS-248.
