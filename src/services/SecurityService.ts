import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import { JwtPayload, SignOptions } from 'jsonwebtoken';

/**
 * User interface representing a user entity.
 * @interface User
 */
interface User {
  /**
   * Unique identifier for the user.
   */
  id: string;
  /**
   * Username chosen by the user.
   */
  username: string;
  /**
   * Email address of the user.
   */
  email: string;
  /**
   * Hashed password for the user.
   */
  password: string;
  /**
   * Role of the user, either 'admin' or 'user'.
   */
  role: 'admin' | 'user';
  /**
   * Timestamp of the user's last login.
   */
  lastLogin?: Date;
  /**
   * Number of failed login attempts.
   */
  failedAttempts: number;
  /**
   * Timestamp until which the user is locked out.
   */
  lockedUntil?: Date;
}

/**
 * AuditLog interface representing an audit log entry.
 * @interface AuditLog
 */
interface AuditLog {
  /**
   * Unique identifier for the audit log entry.
   */
  id: string;
  /**
   * Timestamp of the audit log entry.
   */
  timestamp: Date;
  /**
   * ID of the user who performed the action.
   */
  userId: string;
  /**
   * Action performed by the user.
   */
  action: string;
  /**
   * Resource affected by the action.
   */
  resource: string;
  /**
   * Status of the action, either 'success' or 'failure'.
   */
  status: 'success' | 'failure';
  /**
   * Additional details about the action.
   */
  details?: Record<string, any>;
}

/**
 * SecurityConfig interface representing the security configuration.
 * @interface SecurityConfig
 */
interface SecurityConfig {
  /**
   * Secret key for JWT tokens.
   */
  jwtSecret: string;
  /**
   * Expiration time for JWT tokens in seconds.
   */
  tokenExpiration: number;
  /**
   * Maximum number of failed login attempts before lockout.
   */
  maxFailedAttempts: number;
  /**
   * Duration of lockout in seconds.
   */
  lockoutDuration: number;
  /**
   * Interval for backing up data in seconds.
   */
  backupInterval: number;
  /**
   * Path for storing backups.
   */
  backupPath: string;
  /**
   * Key for encrypting data.
   */
  encryptionKey: string;
}

/**
 * SecurityService class responsible for managing security-related functionality.
 * @class SecurityService
 * @extends EventEmitter
 */
export class SecurityService extends EventEmitter {
  /**
   * Map of users, keyed by their IDs.
   */
  private users: Map<string, User> = new Map();
  /**
   * Array of audit log entries.
   */
  private auditLogs: AuditLog[] = [];
  /**
   * Current security configuration.
   */
  private config: SecurityConfig;
  /**
   * Timer for backing up data.
   */
  private backupTimer: NodeJS.Timeout | null = null;
  /**
   * Map of failed login attempts, keyed by user ID.
   */
  private failedAttempts: Map<string, number> = new Map();
  /**
   * Map of lockout timers, keyed by user ID.
   */
  private lockoutTimers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Constructor for the SecurityService.
   * @param config Security configuration to use.
   */
  constructor(config: SecurityConfig) {
    super();
    this.config = config;
    this.initialize();
  }

  /**
   * Initializes the SecurityService by loading users and starting the backup timer.
   */
  private initialize(): void {
    this.loadUsers();
    this.startBackupTimer();
  }

  /**
   * Loads users from the backup file.
   */
  private loadUsers(): void {
    const usersPath = path.join(this.config.backupPath, 'users.json');
    if (fs.existsSync(usersPath)) {
      try {
        const encryptedData = fs.readFileSync(usersPath, 'utf-8');
        const decryptedData = this.decrypt(encryptedData);
        const users = JSON.parse(decryptedData);
        users.forEach((user: User) => {
          this.users.set(user.id, user);
        });
      } catch (error: unknown) {
        console.error('Failed to load users:', error);
      }
    }
  }

  /**
   * Starts the backup timer.
   */
  private startBackupTimer(): void {
    this.backupTimer = setInterval(() => {
      this.backupData();
    }, this.config.backupInterval);
  }

  /**
   * Backs up the data to a file.
   */
  private async backupData(): Promise<void> {
    try {
      const backupPath = path.join(
        this.config.backupPath,
        `backup_${Date.now()}.json`
      );

      const data = {
        users: Array.from(this.users.values()),
        auditLogs: this.auditLogs
      };

      const encryptedData = this.encrypt(JSON.stringify(data));
      fs.writeFileSync(backupPath, encryptedData);
      this.emit('backupCreated', backupPath);
    } catch (error: unknown) {
      console.error('Failed to create backup:', error);
      this.emit('backupFailed', error);
    }
  }

  /**
   * Registers a new user.
   * @param username Username chosen by the user.
   * @param password Password chosen by the user.
   * @param role Role of the user, either 'admin' or 'user'.
   * @returns JWT token for the newly registered user.
   */
  public async register(username: string, password: string, role: 'admin' | 'user' = 'user'): Promise<string> {
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const user: User = {
        id: crypto.randomBytes(16).toString('hex'),
        username,
        email: '',
        password: hashedPassword,
        role,
        failedAttempts: 0
      };
      this.users.set(user.id, user);
      return this.generateToken(user.id);
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Registration failed: ${error.message}`);
      }
      throw new Error('Registration failed');
    }
  }

  /**
   * Logs in an existing user.
   * @param username Username of the user.
   * @param password Password of the user.
   * @returns JWT token for the logged-in user.
   */
  public async login(username: string, password: string): Promise<string> {
    try {
      const user = Array.from(this.users.values()).find(u => u.username === username);
      if (!user) {
        throw new Error('User not found');
      }

      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        throw new Error('Invalid password');
      }

      user.failedAttempts = 0;
      user.lockedUntil = undefined;
      user.lastLogin = new Date();
      this.users.set(user.id, user);

      return this.generateToken(user.id);
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Login failed: ${error.message}`);
      }
      throw new Error('Login failed');
    }
  }

  /**
   * Validates a JWT token.
   * @param token JWT token to validate.
   * @returns True if the token is valid, false otherwise.
   */
  public async validateToken(token: string): Promise<boolean> {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret) as JwtPayload;
      return decoded.exp ? decoded.exp > Date.now() / 1000 : false;
    } catch (error: unknown) {
      return false;
    }
  }

  /**
   * Refreshes a JWT token.
   * @param token JWT token to refresh.
   * @returns New JWT token.
   */
  public async refreshToken(token: string): Promise<string> {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret) as JwtPayload;
      return this.generateToken(decoded.sub || '');
    } catch (error: unknown) {
      throw new Error('Invalid token');
    }
  }

  /**
   * Generates a JWT token for a user.
   * @param userId ID of the user.
   * @returns JWT token for the user.
   */
  private generateToken(userId: string): string {
    const payload = { sub: userId };
    const options: SignOptions = { expiresIn: this.config.tokenExpiration };
    return jwt.sign(payload, this.config.jwtSecret, options);
  }

  /**
   * Encrypts data using the encryption key.
   * @param data Data to encrypt.
   * @returns Encrypted data.
   */
  private encrypt(data: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(this.config.encryptionKey), iv);
    let encrypted = cipher.update(data);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  }

  /**
   * Decrypts data using the encryption key.
   * @param data Data to decrypt.
   * @returns Decrypted data.
   */
  private decrypt(data: string): string {
    const parts = data.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(this.config.encryptionKey), iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  }

  /**
   * Logs an audit log entry.
   * @param action Action performed.
   * @param userId ID of the user who performed the action.
   * @param resource Resource affected by the action.
   * @param status Status of the action.
   * @param details Additional details about the action.
   */
  private logAudit(
    action: string,
    userId: string,
    resource: string,
    status: 'success' | 'failure',
    details?: Record<string, any>
  ): void {
    const log: AuditLog = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date(),
      userId,
      action,
      resource,
      status,
      details
    };
    this.auditLogs.push(log);
  }

  /**
   * Retrieves audit log entries.
   * @param startDate Start date for filtering.
   * @param endDate End date for filtering.
   * @param userId ID of the user for filtering.
   * @param action Action for filtering.
   * @returns Array of audit log entries.
   */
  public getAuditLogs(
    startDate?: Date,
    endDate?: Date,
    userId?: string,
    action?: string
  ): AuditLog[] {
    return this.auditLogs.filter(log => {
      if (startDate && log.timestamp < startDate) return false;
      if (endDate && log.timestamp > endDate) return false;
      if (userId && log.userId !== userId) return false;
      if (action && log.action !== action) return false;
      return true;
    });
  }

  /**
   * Retrieves a user by ID.
   * @param userId ID of the user.
   * @returns User object or undefined if not found.
   */
  public getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  /**
   * Disposes of the SecurityService.
   */
  public dispose(): void {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
    }
    this.users.clear();
    this.auditLogs = [];
    this.removeAllListeners();
  }
}