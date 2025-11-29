# freestyle_client.IdentityApi

All URIs are relative to *https://api.freestyle.sh*

Method | HTTP request | Description
------------- | ------------- | -------------
[**handle_create_git_token**](IdentityApi.md#handle_create_git_token) | **POST** /identity/v1/identities/{identity}/tokens | Create an access token for an identity
[**handle_create_identity**](IdentityApi.md#handle_create_identity) | **POST** /identity/v1/identities | Create an identity
[**handle_delete_identity**](IdentityApi.md#handle_delete_identity) | **DELETE** /identity/v1/identities/{identity} | Delete an identity
[**handle_describe_git_permission**](IdentityApi.md#handle_describe_git_permission) | **GET** /identity/v1/identities/{identity}/permissions/git/{repo} | Get the git permission of an identity on a repository
[**handle_describe_vm_permission**](IdentityApi.md#handle_describe_vm_permission) | **GET** /identity/v1/identities/{identity}/permissions/vm/{vm_id} | Get VM permission details
[**handle_grant_git_permission**](IdentityApi.md#handle_grant_git_permission) | **POST** /identity/v1/identities/{identity}/permissions/git/{repo} | Grant a git repository permission to an identity
[**handle_grant_vm_permission**](IdentityApi.md#handle_grant_vm_permission) | **POST** /identity/v1/identities/{identity}/permissions/vm/{vm_id} | Grant VM permission to an identity for a VM
[**handle_list_git_permissions**](IdentityApi.md#handle_list_git_permissions) | **GET** /identity/v1/identities/{identity}/permissions/git | List repository permissions for an identity
[**handle_list_git_tokens**](IdentityApi.md#handle_list_git_tokens) | **GET** /identity/v1/identities/{identity}/tokens | List access tokens for an identity
[**handle_list_identities**](IdentityApi.md#handle_list_identities) | **GET** /identity/v1/identities | List identities
[**handle_list_vm_permissions**](IdentityApi.md#handle_list_vm_permissions) | **GET** /identity/v1/identities/{identity}/permissions/vm | List VM permissions for an identity
[**handle_revoke_git_permission**](IdentityApi.md#handle_revoke_git_permission) | **DELETE** /identity/v1/identities/{identity}/permissions/git/{repo} | Revoke git repository permission from an identity
[**handle_revoke_git_token**](IdentityApi.md#handle_revoke_git_token) | **DELETE** /identity/v1/identities/{identity}/tokens/{token} | Revoke an access token for an identity
[**handle_revoke_vm_permission**](IdentityApi.md#handle_revoke_vm_permission) | **DELETE** /identity/v1/identities/{identity}/permissions/vm/{vm_id} | Revoke VM permission from an identity for a VM
[**handle_update_allowed_users**](IdentityApi.md#handle_update_allowed_users) | **PUT** /identity/v1/identities/{identity}/permissions/vm/{vm_id} | Update allowed users for VM permission
[**handle_update_git_permission**](IdentityApi.md#handle_update_git_permission) | **PUT** /identity/v1/identities/{identity}/permissions/git/{repo} | Update a git repository permission for an identity


# **handle_create_git_token**
> CreatedToken handle_create_git_token(identity)

Create an access token for an identity

Create an access token for an identity

### Example


```python
import freestyle_client
from freestyle_client.models.created_token import CreatedToken
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.IdentityApi(api_client)
    identity = 'identity_example' # str | 

    try:
        # Create an access token for an identity
        api_response = api_instance.handle_create_git_token(identity)
        print("The response of IdentityApi->handle_create_git_token:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling IdentityApi->handle_create_git_token: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**|  | 

### Return type

[**CreatedToken**](CreatedToken.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Token created successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_create_identity**
> FreestyleIdentity handle_create_identity()

Create an identity

Create an identity. This identity will be used to authenticate with the Git server.

### Example


```python
import freestyle_client
from freestyle_client.models.freestyle_identity import FreestyleIdentity
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.IdentityApi(api_client)

    try:
        # Create an identity
        api_response = api_instance.handle_create_identity()
        print("The response of IdentityApi->handle_create_identity:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling IdentityApi->handle_create_identity: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

[**FreestyleIdentity**](FreestyleIdentity.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Identity created successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_delete_identity**
> object handle_delete_identity(identity)

Delete an identity

Delete an identity. This will revoke all permissions granted to this identity.

### Example


```python
import freestyle_client
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.IdentityApi(api_client)
    identity = 'identity_example' # str | 

    try:
        # Delete an identity
        api_response = api_instance.handle_delete_identity(identity)
        print("The response of IdentityApi->handle_delete_identity:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling IdentityApi->handle_delete_identity: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**|  | 

### Return type

**object**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Identity deleted |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_describe_git_permission**
> DescribeGitPermissionSuccess handle_describe_git_permission(identity, repo)

Get the git permission of an identity on a repository

Get the permission of an identity on a repository. This will return the access level of the identity on the repository.

### Example


```python
import freestyle_client
from freestyle_client.models.describe_git_permission_success import DescribeGitPermissionSuccess
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.IdentityApi(api_client)
    identity = 'identity_example' # str | The git identity ID
    repo = 'repo_example' # str | The git repository ID

    try:
        # Get the git permission of an identity on a repository
        api_response = api_instance.handle_describe_git_permission(identity, repo)
        print("The response of IdentityApi->handle_describe_git_permission:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling IdentityApi->handle_describe_git_permission: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**| The git identity ID | 
 **repo** | **str**| The git repository ID | 

### Return type

[**DescribeGitPermissionSuccess**](DescribeGitPermissionSuccess.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Permission info |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_describe_vm_permission**
> VmPermission handle_describe_vm_permission(identity, vm_id)

Get VM permission details

Get the details of a VM permission for a specific identity and VM

### Example


```python
import freestyle_client
from freestyle_client.models.vm_permission import VmPermission
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.IdentityApi(api_client)
    identity = 'identity_example' # str | The git identity ID
    vm_id = 'vm_id_example' # str | The VM ID

    try:
        # Get VM permission details
        api_response = api_instance.handle_describe_vm_permission(identity, vm_id)
        print("The response of IdentityApi->handle_describe_vm_permission:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling IdentityApi->handle_describe_vm_permission: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**| The git identity ID | 
 **vm_id** | **str**| The VM ID | 

### Return type

[**VmPermission**](VmPermission.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | VM permission details |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_grant_git_permission**
> object handle_grant_git_permission(identity, repo, grant_git_permission_request)

Grant a git repository permission to an identity

Grant a permission to an identity on a repository

### Example


```python
import freestyle_client
from freestyle_client.models.grant_git_permission_request import GrantGitPermissionRequest
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.IdentityApi(api_client)
    identity = 'identity_example' # str | The git identity ID
    repo = 'repo_example' # str | The git repository ID
    grant_git_permission_request = freestyle_client.GrantGitPermissionRequest() # GrantGitPermissionRequest | 

    try:
        # Grant a git repository permission to an identity
        api_response = api_instance.handle_grant_git_permission(identity, repo, grant_git_permission_request)
        print("The response of IdentityApi->handle_grant_git_permission:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling IdentityApi->handle_grant_git_permission: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**| The git identity ID | 
 **repo** | **str**| The git repository ID | 
 **grant_git_permission_request** | [**GrantGitPermissionRequest**](GrantGitPermissionRequest.md)|  | 

### Return type

**object**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Permission granted successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_grant_vm_permission**
> VmPermission handle_grant_vm_permission(identity, vm_id, grant_vm_permission_request)

Grant VM permission to an identity for a VM

Grant VM access permission to an identity for a specific VM. Optionally restrict access to specific Linux users.

### Example


```python
import freestyle_client
from freestyle_client.models.grant_vm_permission_request import GrantVmPermissionRequest
from freestyle_client.models.vm_permission import VmPermission
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.IdentityApi(api_client)
    identity = 'identity_example' # str | The git identity ID
    vm_id = 'vm_id_example' # str | The VM ID
    grant_vm_permission_request = freestyle_client.GrantVmPermissionRequest() # GrantVmPermissionRequest | 

    try:
        # Grant VM permission to an identity for a VM
        api_response = api_instance.handle_grant_vm_permission(identity, vm_id, grant_vm_permission_request)
        print("The response of IdentityApi->handle_grant_vm_permission:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling IdentityApi->handle_grant_vm_permission: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**| The git identity ID | 
 **vm_id** | **str**| The VM ID | 
 **grant_vm_permission_request** | [**GrantVmPermissionRequest**](GrantVmPermissionRequest.md)|  | 

### Return type

[**VmPermission**](VmPermission.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | VM permission granted successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_list_git_permissions**
> ListGitPermissionSuccess handle_list_git_permissions(identity, limit=limit, offset=offset)

List repository permissions for an identity

List repository permissions for an identity. This will return a list of repositories that the identity has access to.

### Example


```python
import freestyle_client
from freestyle_client.models.list_git_permission_success import ListGitPermissionSuccess
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.IdentityApi(api_client)
    identity = 'identity_example' # str | 
    limit = 56 # int | Maximum number of repositories to return (optional)
    offset = 56 # int | Offset for the list of repositories (optional)

    try:
        # List repository permissions for an identity
        api_response = api_instance.handle_list_git_permissions(identity, limit=limit, offset=offset)
        print("The response of IdentityApi->handle_list_git_permissions:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling IdentityApi->handle_list_git_permissions: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**|  | 
 **limit** | **int**| Maximum number of repositories to return | [optional] 
 **offset** | **int**| Offset for the list of repositories | [optional] 

### Return type

[**ListGitPermissionSuccess**](ListGitPermissionSuccess.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Permission list |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_list_git_tokens**
> ListGitTokensSuccess handle_list_git_tokens(identity)

List access tokens for an identity

List access tokens for an identity

### Example


```python
import freestyle_client
from freestyle_client.models.list_git_tokens_success import ListGitTokensSuccess
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.IdentityApi(api_client)
    identity = 'identity_example' # str | 

    try:
        # List access tokens for an identity
        api_response = api_instance.handle_list_git_tokens(identity)
        print("The response of IdentityApi->handle_list_git_tokens:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling IdentityApi->handle_list_git_tokens: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**|  | 

### Return type

[**ListGitTokensSuccess**](ListGitTokensSuccess.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Token list |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_list_identities**
> ListIdentitiesSuccess handle_list_identities(limit=limit, offset=offset, include_managed=include_managed)

List identities

List identities created by your account.

### Example


```python
import freestyle_client
from freestyle_client.models.list_identities_success import ListIdentitiesSuccess
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.IdentityApi(api_client)
    limit = 56 # int |  (optional)
    offset = 56 # int |  (optional)
    include_managed = True # bool |  (optional)

    try:
        # List identities
        api_response = api_instance.handle_list_identities(limit=limit, offset=offset, include_managed=include_managed)
        print("The response of IdentityApi->handle_list_identities:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling IdentityApi->handle_list_identities: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **limit** | **int**|  | [optional] 
 **offset** | **int**|  | [optional] 
 **include_managed** | **bool**|  | [optional] 

### Return type

[**ListIdentitiesSuccess**](ListIdentitiesSuccess.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of identities |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_list_vm_permissions**
> ListVmPermissionsSuccess handle_list_vm_permissions(identity, limit=limit, offset=offset)

List VM permissions for an identity

List all VM permissions granted to a specific Git identity

### Example


```python
import freestyle_client
from freestyle_client.models.list_vm_permissions_success import ListVmPermissionsSuccess
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.IdentityApi(api_client)
    identity = 'identity_example' # str | 
    limit = 56 # int |  (optional)
    offset = 56 # int |  (optional)

    try:
        # List VM permissions for an identity
        api_response = api_instance.handle_list_vm_permissions(identity, limit=limit, offset=offset)
        print("The response of IdentityApi->handle_list_vm_permissions:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling IdentityApi->handle_list_vm_permissions: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**|  | 
 **limit** | **int**|  | [optional] 
 **offset** | **int**|  | [optional] 

### Return type

[**ListVmPermissionsSuccess**](ListVmPermissionsSuccess.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of VM permissions |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_revoke_git_permission**
> object handle_revoke_git_permission(identity, repo)

Revoke git repository permission from an identity

Revoke a permission to an identity on a repository

### Example


```python
import freestyle_client
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.IdentityApi(api_client)
    identity = 'identity_example' # str | The git identity ID
    repo = 'repo_example' # str | The git repository ID

    try:
        # Revoke git repository permission from an identity
        api_response = api_instance.handle_revoke_git_permission(identity, repo)
        print("The response of IdentityApi->handle_revoke_git_permission:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling IdentityApi->handle_revoke_git_permission: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**| The git identity ID | 
 **repo** | **str**| The git repository ID | 

### Return type

**object**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Permission revoked successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_revoke_git_token**
> object handle_revoke_git_token(identity, token)

Revoke an access token for an identity

Revoke an access token for an identity

### Example


```python
import freestyle_client
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.IdentityApi(api_client)
    identity = 'identity_example' # str | 
    token = 'token_example' # str | 

    try:
        # Revoke an access token for an identity
        api_response = api_instance.handle_revoke_git_token(identity, token)
        print("The response of IdentityApi->handle_revoke_git_token:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling IdentityApi->handle_revoke_git_token: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**|  | 
 **token** | **str**|  | 

### Return type

**object**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Token revoked |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_revoke_vm_permission**
> object handle_revoke_vm_permission(identity, vm_id)

Revoke VM permission from an identity for a VM

Revoke VM permission from an identity for a specific VM

### Example


```python
import freestyle_client
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.IdentityApi(api_client)
    identity = 'identity_example' # str | The git identity ID
    vm_id = 'vm_id_example' # str | The VM ID

    try:
        # Revoke VM permission from an identity for a VM
        api_response = api_instance.handle_revoke_vm_permission(identity, vm_id)
        print("The response of IdentityApi->handle_revoke_vm_permission:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling IdentityApi->handle_revoke_vm_permission: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**| The git identity ID | 
 **vm_id** | **str**| The VM ID | 

### Return type

**object**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | VM permission revoked successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_update_allowed_users**
> VmPermission handle_update_allowed_users(identity, vm_id, update_allowed_users_request_body)

Update allowed users for VM permission

Update the list of allowed users for a VM permission. Set to null to allow all users, or provide a list to restrict access.

### Example


```python
import freestyle_client
from freestyle_client.models.update_allowed_users_request_body import UpdateAllowedUsersRequestBody
from freestyle_client.models.vm_permission import VmPermission
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.IdentityApi(api_client)
    identity = 'identity_example' # str | The git identity ID
    vm_id = 'vm_id_example' # str | The VM ID
    update_allowed_users_request_body = freestyle_client.UpdateAllowedUsersRequestBody() # UpdateAllowedUsersRequestBody | 

    try:
        # Update allowed users for VM permission
        api_response = api_instance.handle_update_allowed_users(identity, vm_id, update_allowed_users_request_body)
        print("The response of IdentityApi->handle_update_allowed_users:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling IdentityApi->handle_update_allowed_users: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**| The git identity ID | 
 **vm_id** | **str**| The VM ID | 
 **update_allowed_users_request_body** | [**UpdateAllowedUsersRequestBody**](UpdateAllowedUsersRequestBody.md)|  | 

### Return type

[**VmPermission**](VmPermission.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Allowed users updated successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_update_git_permission**
> object handle_update_git_permission(identity, repo, update_git_permission_request)

Update a git repository permission for an identity

Update a permission for an identity on a repository

### Example


```python
import freestyle_client
from freestyle_client.models.update_git_permission_request import UpdateGitPermissionRequest
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.IdentityApi(api_client)
    identity = 'identity_example' # str | The git identity ID
    repo = 'repo_example' # str | The git repository ID
    update_git_permission_request = freestyle_client.UpdateGitPermissionRequest() # UpdateGitPermissionRequest | 

    try:
        # Update a git repository permission for an identity
        api_response = api_instance.handle_update_git_permission(identity, repo, update_git_permission_request)
        print("The response of IdentityApi->handle_update_git_permission:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling IdentityApi->handle_update_git_permission: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**| The git identity ID | 
 **repo** | **str**| The git repository ID | 
 **update_git_permission_request** | [**UpdateGitPermissionRequest**](UpdateGitPermissionRequest.md)|  | 

### Return type

**object**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Permission updated successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

