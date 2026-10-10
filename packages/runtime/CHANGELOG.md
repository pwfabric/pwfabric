# @pwfabric/runtime

## Unreleased

- Removed: `DataCapability`, `DefaultDataCapability`, `createDataCapability` (use `DataServiceInterface`, `DataService`, `createDataService`); `EntityCapability`, `DefaultEntityCapability`, `createEntityCapability` (use `EntityFacade`, `DefaultEntityFacade`, `createEntityFacade`); `EntityBehavior`, `BehaviorEngine`, `DefaultBehaviorEngine`, `createBehaviorEngine` and the facade's `behaviors` accessor and option (use `EntityLifecycleHook`, `EntityLifecycleEngine`, `DefaultEntityLifecycleEngine`, `createEntityLifecycleEngine`, `entityLifecycle`) (deprecated).
- Themes no longer emit `--pw-color-surface`; use `--pw-color-card`.

## 1.0.0-rc.0

First release under the @pwfabric scope.
