import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import { JwtPayload, SignOptions } from 'jsonwebtoken';

interface User {
  id: string;
  username: string;
  email: string;
  password: string;
  role: 'admin' | 'user';
  lastLogin?: Date;
  failedAttempts: number;
  lockedUntil?: Date;
}

interface AuditLog {
  id: string;
  timestamp: Date;
  userId: string;
  action: string;
  resource: string;
  status: 'success' | 'failure';
  details?: Record<string, any>;
}

interface SecurityConfig {
  jwtSecret: string;
  tokenExpiration: number;
  maxFailedAttempts: number;
  lockoutDuration: number;
  backupInterval: number;
  backupPath: string;
  encryptionKey: string;
}

export class SecurityService extends EventEmitter {
  private users: Map<string, User> = new Map();
  private auditLogs: AuditLog[] = [];
  private config: SecurityConfig;
  private backupTimer: NodeJS.Timeout | null = null;
  private failedAttempts: Map<string, number> = new Map();
  private lockoutTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: SecurityConfig) {
    super();
    this.config = config;
    this.initialize();
  }

  private initialize(): void {
    this.loadUsers();
    this.startBackupTimer();
  }

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

  private startBackupTimer(): void {
    this.backupTimer = setInterval(() => {
      this.backupData();
    }, this.config.backupInterval);
  }

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

  public async register(username: string, password: string, role: 'admin' | 'user' = 'user'): Promise<string> {
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const user: User = {
        id: crypto.randomBytes(6).toString('base64url').substr(0, 9),
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

  public async validateToken(token: string): Promise<boolean> {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret) as JwtPayload;
      return decoded.exp ? decoded.exp > Date.now() / 1000 : false;
    } catch (error: unknown) {
      return false;
    }
  }

  public async refreshToken(token: string): Promise<string> {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret) as JwtPayload;
      return this.generateToken(decoded.sub || '');
    } catch (error: unknown) {
      throw new Error('Invalid token');
    }
  }

  private generateToken(userId: string): string {
    const payload = { sub: userId };
    const options: SignOptions = { expiresIn: this.config.tokenExpiration };
    return jwt.sign(payload, this.config.jwtSecret, options);
  }

  private encrypt(data: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(this.config.encryptionKey), iv);
    let encrypted = cipher.update(data);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  }

  private decrypt(data: string): string {
    const parts = data.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(this.config.encryptionKey), iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  }

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

  public getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  public dispose(): void {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
    }
    this.users.clear();
    this.auditLogs = [];
    this.removeAllListeners();
  }
} 