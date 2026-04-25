import type { Repository } from 'typeorm';
import { Parent, ParentContact } from '@app/database';
import { ContactType, NotificationChannel } from '@app/shared';
import { ParentsService } from './parents.service';
import { NotificationService } from '../notification/notification.service';

function buildService(
  hasChannel: (c: NotificationChannel) => boolean,
  contactRepo: Pick<Repository<ParentContact>, 'create' | 'save' | 'update' | 'find'>,
): ParentsService {
  const parentRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'p1', contacts: [], patients: [] } as unknown as Parent),
  } as unknown as Repository<Parent>;
  const notifications = { hasChannel } as unknown as NotificationService;
  return new ParentsService(parentRepo, contactRepo as Repository<ParentContact>, notifications);
}

describe('ParentsService.addContact', () => {
  it('marks the contact verified immediately when the matching channel is not configured', async () => {
    const created: Partial<ParentContact>[] = [];
    const repo = {
      create: jest.fn((data: Partial<ParentContact>) => {
        const c = { id: 'c1', ...data } as ParentContact;
        created.push(c);
        return c;
      }),
      save: jest.fn(async (c: ParentContact) => c),
      update: jest.fn(),
      find: jest.fn(),
    };
    const svc = buildService(() => false, repo);

    const out = await svc.addContact('p1', {
      type: ContactType.EMAIL,
      value: 'parent@example.com',
    } as never);

    expect(out.isVerified).toBe(true);
    expect(created[0]?.isVerified).toBe(true);
    expect(repo.save).toHaveBeenCalled();
  });

  it('leaves the contact unverified when the matching channel is configured', async () => {
    const repo = {
      create: jest.fn((data: Partial<ParentContact>) => ({ id: 'c1', ...data }) as ParentContact),
      save: jest.fn(async (c: ParentContact) => c),
      update: jest.fn(),
      find: jest.fn(),
    };
    const svc = buildService((c) => c === NotificationChannel.EMAIL, repo);

    const out = await svc.addContact('p1', {
      type: ContactType.EMAIL,
      value: 'parent@example.com',
    } as never);

    expect(out.isVerified).toBe(false);
  });

  it('routes phone contacts to the SMS channel', async () => {
    const probed: NotificationChannel[] = [];
    const repo = {
      create: jest.fn((data: Partial<ParentContact>) => ({ id: 'c1', ...data }) as ParentContact),
      save: jest.fn(async (c: ParentContact) => c),
      update: jest.fn(),
      find: jest.fn(),
    };
    const svc = buildService((c) => {
      probed.push(c);
      return c === NotificationChannel.SMS;
    }, repo);

    const out = await svc.addContact('p1', {
      type: ContactType.PHONE,
      value: '+15555550100',
    } as never);

    expect(probed).toContain(NotificationChannel.SMS);
    expect(out.isVerified).toBe(false);
  });

  it('clears the previous primary flag when isPrimary is set', async () => {
    const repo = {
      create: jest.fn((data: Partial<ParentContact>) => ({ id: 'c1', ...data }) as ParentContact),
      save: jest.fn(async (c: ParentContact) => c),
      update: jest.fn(),
      find: jest.fn(),
    };
    const svc = buildService(() => true, repo);

    await svc.addContact('p1', {
      type: ContactType.EMAIL,
      value: 'parent@example.com',
      isPrimary: true,
    } as never);

    expect(repo.update).toHaveBeenCalledWith({ parentId: 'p1' }, { isPrimary: false });
  });
});
