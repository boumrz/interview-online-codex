## ADDED Requirements

### Requirement: Hiring-manager preview does not weaken creation-time assignment validation

An eligible pre-submit hiring-manager preview SHALL be informational only and SHALL NOT substitute for the existing authenticated room-creation validation, authorization, atomicity, or privacy guarantees. On every authenticated room-create request that supplies `hiringManagerIds`, the server SHALL use current stored target capability and the authenticated creator identity at commit time, regardless of any client preview result, client-provided display name, target role claim, cached eligibility, or request ordering. The public/guest creation contract SHALL remain unchanged.

If a target has changed, expired, been made ineligible, or becomes unavailable after a preview succeeds, the create operation SHALL retain its established all-or-nothing outcome: it SHALL create no room, tasks, memberships, or tracked associations and return only the established generic correction feedback. A later retry after correction SHALL be evaluated afresh. Preview requests and create requests SHALL NOT create a circular wait or cause duplicate room creation; a delayed preview response SHALL not overwrite confirmed create success, an error, or a newer draft state.

Pre-implementation acceptance-test level: **E2E** for the creator's corrected-draft and no-false-success journey; supplemented by a **backend integration exception** for target-capability changes, forged preview fields, no partial writes, and concurrent lookup/create ordering, which cannot be deterministically proven through a browser flow alone.

#### Scenario: Creation revalidates an eligible preview

- **WHEN** a creator receives an eligible preview and the target loses hiring-manager capability before the creation transaction validates the target
- **THEN** room creation fails with the existing privacy-safe unavailable feedback and creates no partial room or assignment
- **AND** the client does not portray the earlier preview as a completed assignment

#### Scenario: A corrected result is submitted once

- **WHEN** a creator replaces an unavailable UUID with an eligible UUID and submits the form while a prior lookup is delayed or cancelled
- **THEN** the server evaluates only the submitted normalized target list under the existing create contract
- **AND** exactly one successful room create produces the established durable association and room-local access for the effective target
- **AND** the prior lookup result cannot alter the confirmed room or the current form state
