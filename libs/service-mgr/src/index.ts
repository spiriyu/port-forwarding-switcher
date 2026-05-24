export { type ServiceManager, type ServiceStatus, type ServiceInstallOptions } from './interface';
export { MockServiceManager, type MockCall } from './mock';
export { LaunchdServiceManager, buildPlist } from './platforms/macos';
export { SystemdServiceManager, buildUnit } from './platforms/linux';
export { WindowsServiceManager } from './platforms/windows';
export { createServiceManager } from './factory';
export const version = '0.0.1';
