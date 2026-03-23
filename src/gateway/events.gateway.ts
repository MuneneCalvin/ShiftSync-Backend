import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/',
})
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  afterInit(_server: Server) {
    this.logger.log('Socket.io gateway initialized');
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET,
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: {
          certifications: true,
          managedLocations: true,
        },
      });

      if (!user) {
        client.disconnect();
        return;
      }

      // Store user info on socket
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).userId = user.id;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).userRole = user.role;

      // Join private user room
      await client.join(`user:${user.id}`);

      // Join role rooms
      if (user.role === 'ADMIN') {
        await client.join('admin');
      }
      if (user.role === 'MANAGER' || user.role === 'ADMIN') {
        await client.join(`manager:${user.id}`);
        // Join all managed location rooms
        for (const ml of user.managedLocations) {
          await client.join(`location:${ml.locationId}`);
        }
      }
      if (user.role === 'STAFF') {
        // Join rooms for all certified locations
        for (const cert of user.certifications) {
          await client.join(`location:${cert.locationId}`);
        }
      }

      this.logger.log(`Client connected: ${user.name} (${user.role}) — rooms: ${[...client.rooms].join(', ')}`);
    } catch (err) {
      this.logger.warn(`Connection rejected: ${err instanceof Error ? err.message : String(err)}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // Allow client to join a specific room (e.g., after navigating to a location schedule)
  @SubscribeMessage('join:location')
  async handleJoinLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { locationId: string },
  ) {
    await client.join(`location:${data.locationId}`);
    return { success: true };
  }

  // ── Emit helpers (called by services) ───────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitToLocation(locationId: string, event: string, data: any) {
    this.server.to(`location:${locationId}`).emit(event, data);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitToManager(managerId: string, event: string, data: any) {
    this.server.to(`manager:${managerId}`).emit(event, data);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitToAdmin(event: string, data: any) {
    this.server.to('admin').emit(event, data);
  }
}
