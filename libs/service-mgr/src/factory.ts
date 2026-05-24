import { type ServiceManager } from './interface';
import { LaunchdServiceManager } from './platforms/macos';
import { SystemdServiceManager } from './platforms/linux';
import { WindowsServiceManager } from './platforms/windows';
import { MockServiceManager } from './mock';

export function createServiceManager(): ServiceManager {
  switch (process.platform) {
    case 'darwin':
      return new LaunchdServiceManager();
    case 'linux':
      return new SystemdServiceManager();
    case 'win32':
      return new WindowsServiceManager();
    default:
      return new MockServiceManager();
  }
}
