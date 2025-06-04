import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';

/**
 * Authentication module that provides JWT-based authentication
 * Configures Passport.js with JWT strategy and exports auth services
 */
@Module({
  imports: [
    // Import ConfigModule to access environment variables
    ConfigModule,
    
    // Import UsersModule to access user-related services
    UsersModule,
    
    // Configure PassportModule with JWT as default strategy
    PassportModule.register({ defaultStrategy: 'jwt' }),
    
    // Configure JwtModule with secret and expiration from environment
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN', '1d'),
          issuer: 'calaim-assistant',
        },
        verifyOptions: {
          ignoreExpiration: false,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    // Auth service for authentication logic
    AuthService,
    
    // JWT strategy for Passport
    JwtStrategy,
    
    // Guards for protecting routes
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [
    // Export services and modules for use in other modules
    AuthService,
    JwtModule,
    JwtAuthGuard,
    RolesGuard,
  ],
})
export class AuthModule {}
