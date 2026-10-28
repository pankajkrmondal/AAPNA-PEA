# Super Admin guide

**For:** Super Admins of AAPNA PEA. **Version:** October 2026.

A Super Admin can do everything an Admin can (see the [Admin guide](02-ADMIN-GUIDE.md)), plus:
- create and manage **admins** and other **Super Admins**;
- **delete** accounts;
- see the **Not in effect** tab in Settings.

**Contents**
1. [Managing admins and Super Admins](#1-managing-admins-and-super-admins)
2. [Deleting an account](#2-deleting-an-account)
3. [Not in effect](#3-not-in-effect)
4. [Good practice](#4-good-practice)

---

## 1. Managing admins and Super Admins
In **Admin Portal → User Management**:

| You can | Notes |
|---|---|
| Create accounts of any role, including **Super Admin** | The **Role** list offers Super Admin to you only |
| Edit admins and HR users: details, role, status, password | Changing the role or password, or deactivating, signs them out everywhere at once |
| Edit another Super Admin's details, role and status | **Not their password**: only they can change it. To stop a Super Admin's access, deactivate the account |
| **Delete** an account | The only role that can (section 2) |

You can't change your own role or status, or delete yourself.

**The last active Super Admin** cannot be demoted, deactivated or deleted. Make someone else a Super Admin first.

## 2. Deleting an account
The bin icon in User Management. It is permanent: the account, its module access and its notifications go. **Deactivate instead** if the person may come back, or if you want to keep a record of who they were.

## 3. Not in effect
**Settings → Not in effect** (Super Admins only) lists rows stored in the database that nothing in PEA reads. It exists so that nobody changes one directly in the database expecting an effect. The right-hand column says where the real control is. You don't need to do anything on this tab.

## 4. Good practice
- Keep at least **two** Super Admins, so one can manage the other's account.
- Give Super Admin only to the people who look after PEA. Admin is enough for day-to-day user management and settings.
- Deactivate before you delete.
- Look at **Sent emails** and the Dashboard's **Not sent yet** tile once a week: an email that keeps failing is worth a message to the PEA team.
