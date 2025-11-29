# freestyle_client.GitApi

All URIs are relative to *https://api.freestyle.sh*

Method | HTTP request | Description
------------- | ------------- | -------------
[**configure_github_sync**](GitApi.md#configure_github_sync) | **POST** /git/v1/repo/{repo_id}/github-sync | Configure GitHub sync for repository
[**delete_dev_server_configuration**](GitApi.md#delete_dev_server_configuration) | **DELETE** /git/v1/repo/{repo_id}/dev-server-configuration | Delete dev server configuration
[**get_dev_server_configuration**](GitApi.md#get_dev_server_configuration) | **GET** /git/v1/repo/{repo_id}/dev-server-configuration | Get dev server configuration
[**get_github_sync**](GitApi.md#get_github_sync) | **GET** /git/v1/repo/{repo_id}/github-sync | Get GitHub sync configuration
[**handle_compare_commits**](GitApi.md#handle_compare_commits) | **GET** /git/v1/repo/{repo}/compare | Compare two commits
[**handle_create_git_trigger**](GitApi.md#handle_create_git_trigger) | **POST** /git/v1/repo/{repo}/trigger | Create a git trigger
[**handle_create_repo**](GitApi.md#handle_create_repo) | **POST** /git/v1/repo | Create a repository
[**handle_delete_git_trigger**](GitApi.md#handle_delete_git_trigger) | **DELETE** /git/v1/repo/{repo}/trigger/{trigger} | Delete a git trigger
[**handle_delete_repo**](GitApi.md#handle_delete_repo) | **DELETE** /git/v1/repo/{repo} | Delete a repository
[**handle_download_tarball**](GitApi.md#handle_download_tarball) | **GET** /git/v1/repo/{repo}/tarball | Download a tarball of a repo
[**handle_download_zip**](GitApi.md#handle_download_zip) | **GET** /git/v1/repo/{repo}/zip | Download a zip of a repo
[**handle_get_blob**](GitApi.md#handle_get_blob) | **GET** /git/v1/repo/{repo}/git/blobs/{hash} | Get a blob object
[**handle_get_commit**](GitApi.md#handle_get_commit) | **GET** /git/v1/repo/{repo}/git/commits/{hash} | Get a commit object
[**handle_get_contents**](GitApi.md#handle_get_contents) | **GET** /git/v1/repo/{repo}/contents/{path} | Get the contents of a file or directory
[**handle_get_default_branch**](GitApi.md#handle_get_default_branch) | **GET** /git/v1/repo/{repo_id}/default-branch | Get repository default branch
[**handle_get_ref_branch**](GitApi.md#handle_get_ref_branch) | **GET** /git/v1/repo/{repo}/git/refs/heads/{branch} | Get a branch reference
[**handle_get_ref_tag**](GitApi.md#handle_get_ref_tag) | **GET** /git/v1/repo/{repo}/git/refs/tags/{tag} | Get a tag reference
[**handle_get_repo_info**](GitApi.md#handle_get_repo_info) | **GET** /git/v1/repo/{repo} | Get repository information
[**handle_get_tag**](GitApi.md#handle_get_tag) | **GET** /git/v1/repo/{repo}/git/tags/{hash} | Get a tag object
[**handle_get_tree**](GitApi.md#handle_get_tree) | **GET** /git/v1/repo/{repo}/git/trees/{hash} | Get a tree object
[**handle_list_commits**](GitApi.md#handle_list_commits) | **GET** /git/v1/repo/{repo}/git/commits | List commits for a repository
[**handle_list_git_triggers**](GitApi.md#handle_list_git_triggers) | **GET** /git/v1/repo/{repo}/trigger | List git triggers for a repository
[**handle_list_repositories**](GitApi.md#handle_list_repositories) | **GET** /git/v1/repo | List repositories
[**handle_set_default_branch**](GitApi.md#handle_set_default_branch) | **PUT** /git/v1/repo/{repo_id}/default-branch | Set repository default branch
[**remove_github_sync**](GitApi.md#remove_github_sync) | **DELETE** /git/v1/repo/{repo_id}/github-sync | Remove GitHub sync configuration
[**update_dev_server_configuration**](GitApi.md#update_dev_server_configuration) | **PUT** /git/v1/repo/{repo_id}/dev-server-configuration | Update dev server configuration


# **configure_github_sync**
> configure_github_sync(repo_id, configure_github_sync_request)

Configure GitHub sync for repository

Configure GitHub synchronization for an existing Freestyle repository. This links your Freestyle repository to a GitHub repository for automatic syncing. Requires the GitHub repository name in 'owner/repo' format.

### Example


```python
import freestyle_client
from freestyle_client.models.configure_github_sync_request import ConfigureGithubSyncRequest
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
    api_instance = freestyle_client.GitApi(api_client)
    repo_id = 'repo_id_example' # str | Repository ID
    configure_github_sync_request = freestyle_client.ConfigureGithubSyncRequest() # ConfigureGithubSyncRequest | 

    try:
        # Configure GitHub sync for repository
        api_instance.configure_github_sync(repo_id, configure_github_sync_request)
    except Exception as e:
        print("Exception when calling GitApi->configure_github_sync: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo_id** | **str**| Repository ID | 
 **configure_github_sync_request** | [**ConfigureGithubSyncRequest**](ConfigureGithubSyncRequest.md)|  | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: Not defined

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | GitHub sync configured successfully |  -  |
**400** | Bad request |  -  |
**404** | Repository not found |  -  |
**500** | Internal server error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **delete_dev_server_configuration**
> delete_dev_server_configuration(repo_id, branch)

Delete dev server configuration

Delete the dev server configuration for a repository and branch. If no branch is specified, deletes configuration for the default branch.

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
    api_instance = freestyle_client.GitApi(api_client)
    repo_id = 'repo_id_example' # str | Repository ID
    branch = 'branch_example' # str | Git branch name (optional, defaults to repository default branch)

    try:
        # Delete dev server configuration
        api_instance.delete_dev_server_configuration(repo_id, branch)
    except Exception as e:
        print("Exception when calling GitApi->delete_dev_server_configuration: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo_id** | **str**| Repository ID | 
 **branch** | **str**| Git branch name (optional, defaults to repository default branch) | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**204** | Dev server configuration deleted successfully |  -  |
**404** | Repository or configuration not found |  -  |
**500** | Internal server error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_dev_server_configuration**
> DevServerConfiguration get_dev_server_configuration(repo_id, branch)

Get dev server configuration

Get the dev server configuration for a repository and branch.

### Example


```python
import freestyle_client
from freestyle_client.models.dev_server_configuration import DevServerConfiguration
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
    api_instance = freestyle_client.GitApi(api_client)
    repo_id = 'repo_id_example' # str | Repository ID
    branch = 'branch_example' # str | Git branch name

    try:
        # Get dev server configuration
        api_response = api_instance.get_dev_server_configuration(repo_id, branch)
        print("The response of GitApi->get_dev_server_configuration:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GitApi->get_dev_server_configuration: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo_id** | **str**| Repository ID | 
 **branch** | **str**| Git branch name | 

### Return type

[**DevServerConfiguration**](DevServerConfiguration.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Dev server configuration |  -  |
**404** | Repository or configuration not found |  -  |
**500** | Internal server error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_github_sync**
> GithubSyncConfigResponse get_github_sync(repo_id)

Get GitHub sync configuration

Get the GitHub sync configuration for a repository, if configured.

### Example


```python
import freestyle_client
from freestyle_client.models.github_sync_config_response import GithubSyncConfigResponse
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
    api_instance = freestyle_client.GitApi(api_client)
    repo_id = 'repo_id_example' # str | Repository ID

    try:
        # Get GitHub sync configuration
        api_response = api_instance.get_github_sync(repo_id)
        print("The response of GitApi->get_github_sync:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GitApi->get_github_sync: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo_id** | **str**| Repository ID | 

### Return type

[**GithubSyncConfigResponse**](GithubSyncConfigResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | GitHub sync configuration |  -  |
**404** | Repository or sync configuration not found |  -  |
**500** | Internal server error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_compare_commits**
> CommitComparison handle_compare_commits(repo, base, head)

Compare two commits

Get the comparison between two commits in a repository

### Example


```python
import freestyle_client
from freestyle_client.models.commit_comparison import CommitComparison
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
    api_instance = freestyle_client.GitApi(api_client)
    repo = 'repo_example' # str | The repository id
    base = 'main' # str | Base revision (commit SHA, branch name, tag, or any valid Git revision)
    head = 'dev' # str | Head revision (commit SHA, branch name, tag, or any valid Git revision)

    try:
        # Compare two commits
        api_response = api_instance.handle_compare_commits(repo, base, head)
        print("The response of GitApi->handle_compare_commits:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GitApi->handle_compare_commits: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo** | **str**| The repository id | 
 **base** | **str**| Base revision (commit SHA, branch name, tag, or any valid Git revision) | 
 **head** | **str**| Head revision (commit SHA, branch name, tag, or any valid Git revision) | 

### Return type

[**CommitComparison**](CommitComparison.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Comparison retrieved successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_create_git_trigger**
> HandleCreateGitTrigger200Response handle_create_git_trigger(repo, handle_create_git_trigger_request)

Create a git trigger

Create a git trigger for the given repository.

### Example


```python
import freestyle_client
from freestyle_client.models.handle_create_git_trigger200_response import HandleCreateGitTrigger200Response
from freestyle_client.models.handle_create_git_trigger_request import HandleCreateGitTriggerRequest
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
    api_instance = freestyle_client.GitApi(api_client)
    repo = 'repo_example' # str | The repository id
    handle_create_git_trigger_request = freestyle_client.HandleCreateGitTriggerRequest() # HandleCreateGitTriggerRequest | 

    try:
        # Create a git trigger
        api_response = api_instance.handle_create_git_trigger(repo, handle_create_git_trigger_request)
        print("The response of GitApi->handle_create_git_trigger:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GitApi->handle_create_git_trigger: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo** | **str**| The repository id | 
 **handle_create_git_trigger_request** | [**HandleCreateGitTriggerRequest**](HandleCreateGitTriggerRequest.md)|  | 

### Return type

[**HandleCreateGitTrigger200Response**](HandleCreateGitTrigger200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Trigger created successfully |  -  |
**400** | Invalid request |  -  |
**403** | User does not have permission to create a trigger on this repository |  -  |
**404** | Repository does not exist |  -  |
**500** | Internal server error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_create_repo**
> CreateRepositoryResponseSuccess handle_create_repo(handle_create_repo_request)

Create a repository

Create a repository. Once the repository is created, it will also be created on the Git server.
The repository name must be unique within your account.

Once created, you can then push your code to this repository.

The repo will be available at `git.freestyle.sh/{repo-id}`


### Example


```python
import freestyle_client
from freestyle_client.models.create_repository_response_success import CreateRepositoryResponseSuccess
from freestyle_client.models.handle_create_repo_request import HandleCreateRepoRequest
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
    api_instance = freestyle_client.GitApi(api_client)
    handle_create_repo_request = freestyle_client.HandleCreateRepoRequest() # HandleCreateRepoRequest | 

    try:
        # Create a repository
        api_response = api_instance.handle_create_repo(handle_create_repo_request)
        print("The response of GitApi->handle_create_repo:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GitApi->handle_create_repo: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **handle_create_repo_request** | [**HandleCreateRepoRequest**](HandleCreateRepoRequest.md)|  | 

### Return type

[**CreateRepositoryResponseSuccess**](CreateRepositoryResponseSuccess.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Repository created successfully |  -  |
**500** | Error: InternalServerError |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_delete_git_trigger**
> object handle_delete_git_trigger(repo, trigger)

Delete a git trigger

Delete a git trigger. This is irreversible.

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
    api_instance = freestyle_client.GitApi(api_client)
    repo = 'repo_example' # str | The repository id
    trigger = 'trigger_example' # str | The trigger id

    try:
        # Delete a git trigger
        api_response = api_instance.handle_delete_git_trigger(repo, trigger)
        print("The response of GitApi->handle_delete_git_trigger:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GitApi->handle_delete_git_trigger: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo** | **str**| The repository id | 
 **trigger** | **str**| The trigger id | 

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
**200** | Trigger deleted successfully |  -  |
**400** | Invalid request |  -  |
**403** | User does not have permission to delete a trigger on this repository |  -  |
**404** | Trigger does not exist |  -  |
**500** | Internal server error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_delete_repo**
> object handle_delete_repo(repo)

Delete a repository

Delete a repository. This is irreversible, and will also delete the repository on the Git server.

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
    api_instance = freestyle_client.GitApi(api_client)
    repo = 'repo_example' # str | The repository id

    try:
        # Delete a repository
        api_response = api_instance.handle_delete_repo(repo)
        print("The response of GitApi->handle_delete_repo:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GitApi->handle_delete_repo: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo** | **str**| The repository id | 

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
**200** | Repository deleted successfully |  -  |
**403** | Error: Forbidden |  -  |
**404** | Error: RepoNotFound |  -  |
**500** | Error: Internal |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_download_tarball**
> handle_download_tarball(repo, ref=ref)

Download a tarball of a repo

Download the contents of a repo as a tarball.

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
    api_instance = freestyle_client.GitApi(api_client)
    repo = 'repo_example' # str | The repository id
    ref = 'ref_example' # str | The git reference (branch name, commit SHA, etc.). Defaults to HEAD. (optional)

    try:
        # Download a tarball of a repo
        api_instance.handle_download_tarball(repo, ref=ref)
    except Exception as e:
        print("Exception when calling GitApi->handle_download_tarball: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo** | **str**| The repository id | 
 **ref** | **str**| The git reference (branch name, commit SHA, etc.). Defaults to HEAD. | [optional] 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/x-tar

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success (byte stream) |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_download_zip**
> handle_download_zip(repo, ref=ref)

Download a zip of a repo

Download the contents of a repo as a zip.

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
    api_instance = freestyle_client.GitApi(api_client)
    repo = 'repo_example' # str | The repository id
    ref = 'ref_example' # str | The git reference (branch name, commit SHA, etc.). Defaults to HEAD. (optional)

    try:
        # Download a zip of a repo
        api_instance.handle_download_zip(repo, ref=ref)
    except Exception as e:
        print("Exception when calling GitApi->handle_download_zip: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo** | **str**| The repository id | 
 **ref** | **str**| The git reference (branch name, commit SHA, etc.). Defaults to HEAD. | [optional] 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/zip

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success (byte stream) |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_get_blob**
> BlobObject handle_get_blob(repo, hash)

Get a blob object

Get a blob from the Git database. The contents will always be base64 encoded.

### Example


```python
import freestyle_client
from freestyle_client.models.blob_object import BlobObject
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
    api_instance = freestyle_client.GitApi(api_client)
    repo = 'repo_example' # str | The repository id
    hash = 'hash_example' # str | The object's hash

    try:
        # Get a blob object
        api_response = api_instance.handle_get_blob(repo, hash)
        print("The response of GitApi->handle_get_blob:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GitApi->handle_get_blob: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo** | **str**| The repository id | 
 **hash** | **str**| The object&#39;s hash | 

### Return type

[**BlobObject**](BlobObject.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Blob retrieved successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_get_commit**
> CommitObject handle_get_commit(repo, hash)

Get a commit object

Get a commit from the Git database with detailed information.

### Example


```python
import freestyle_client
from freestyle_client.models.commit_object import CommitObject
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
    api_instance = freestyle_client.GitApi(api_client)
    repo = 'repo_example' # str | The repository id
    hash = 'hash_example' # str | The object's hash

    try:
        # Get a commit object
        api_response = api_instance.handle_get_commit(repo, hash)
        print("The response of GitApi->handle_get_commit:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GitApi->handle_get_commit: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo** | **str**| The repository id | 
 **hash** | **str**| The object&#39;s hash | 

### Return type

[**CommitObject**](CommitObject.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Commit retrieved successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_get_contents**
> GitContents handle_get_contents(repo, path, ref=ref)

Get the contents of a file or directory

Get the contents of a file or directory in a repository

### Example


```python
import freestyle_client
from freestyle_client.models.git_contents import GitContents
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
    api_instance = freestyle_client.GitApi(api_client)
    repo = 'repo_example' # str | The repository ID.
    path = 'path_example' # str | The path to the file or directory. Empty for root.
    ref = 'ref_example' # str | The git reference (branch name, commit SHA, etc.). Defaults to HEAD. (optional)

    try:
        # Get the contents of a file or directory
        api_response = api_instance.handle_get_contents(repo, path, ref=ref)
        print("The response of GitApi->handle_get_contents:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GitApi->handle_get_contents: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo** | **str**| The repository ID. | 
 **path** | **str**| The path to the file or directory. Empty for root. | 
 **ref** | **str**| The git reference (branch name, commit SHA, etc.). Defaults to HEAD. | [optional] 

### Return type

[**GitContents**](GitContents.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_get_default_branch**
> GetDefaultBranchResponse handle_get_default_branch(repo_id)

Get repository default branch

Get the default branch name for a repository.

### Example


```python
import freestyle_client
from freestyle_client.models.get_default_branch_response import GetDefaultBranchResponse
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
    api_instance = freestyle_client.GitApi(api_client)
    repo_id = 'repo_id_example' # str | The repository ID

    try:
        # Get repository default branch
        api_response = api_instance.handle_get_default_branch(repo_id)
        print("The response of GitApi->handle_get_default_branch:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GitApi->handle_get_default_branch: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo_id** | **str**| The repository ID | 

### Return type

[**GetDefaultBranchResponse**](GetDefaultBranchResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**403** | Error: Forbidden |  -  |
**404** | Error: RepoNotFound |  -  |
**500** | Error: Internal |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_get_ref_branch**
> GitReference handle_get_ref_branch(repo, branch)

Get a branch reference

Get a reference to a branch in the Git repository. Returns the ref name and SHA of the branch.

### Example


```python
import freestyle_client
from freestyle_client.models.git_reference import GitReference
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
    api_instance = freestyle_client.GitApi(api_client)
    repo = 'repo_example' # str | The repository id
    branch = 'branch_example' # str | The branch's name

    try:
        # Get a branch reference
        api_response = api_instance.handle_get_ref_branch(repo, branch)
        print("The response of GitApi->handle_get_ref_branch:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GitApi->handle_get_ref_branch: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo** | **str**| The repository id | 
 **branch** | **str**| The branch&#39;s name | 

### Return type

[**GitReference**](GitReference.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Branch reference retrieved successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_get_ref_tag**
> GitReference handle_get_ref_tag(repo, tag)

Get a tag reference

Get a reference to a tag in the Git repository. Returns the ref name and SHA of the tag.

### Example


```python
import freestyle_client
from freestyle_client.models.git_reference import GitReference
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
    api_instance = freestyle_client.GitApi(api_client)
    repo = 'repo_example' # str | The repository id
    tag = 'tag_example' # str | The tag's name

    try:
        # Get a tag reference
        api_response = api_instance.handle_get_ref_tag(repo, tag)
        print("The response of GitApi->handle_get_ref_tag:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GitApi->handle_get_ref_tag: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo** | **str**| The repository id | 
 **tag** | **str**| The tag&#39;s name | 

### Return type

[**GitReference**](GitReference.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Tag reference retrieved successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_get_repo_info**
> RepositoryInfoRaw handle_get_repo_info(repo)

Get repository information

Retrieve information about a specific repository, including its ID, name, and default branch.

### Example


```python
import freestyle_client
from freestyle_client.models.repository_info_raw import RepositoryInfoRaw
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
    api_instance = freestyle_client.GitApi(api_client)
    repo = 'repo_example' # str | The repository id

    try:
        # Get repository information
        api_response = api_instance.handle_get_repo_info(repo)
        print("The response of GitApi->handle_get_repo_info:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GitApi->handle_get_repo_info: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo** | **str**| The repository id | 

### Return type

[**RepositoryInfoRaw**](RepositoryInfoRaw.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Repository information retrieved successfully |  -  |
**400** | Invalid request |  -  |
**403** | Forbidden access to repository |  -  |
**404** | Repository not found |  -  |
**500** | Internal server error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_get_tag**
> TagObject handle_get_tag(repo, hash)

Get a tag object

Get a tag from the Git database.

### Example


```python
import freestyle_client
from freestyle_client.models.tag_object import TagObject
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
    api_instance = freestyle_client.GitApi(api_client)
    repo = 'repo_example' # str | The repository id
    hash = 'hash_example' # str | The object's hash

    try:
        # Get a tag object
        api_response = api_instance.handle_get_tag(repo, hash)
        print("The response of GitApi->handle_get_tag:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GitApi->handle_get_tag: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo** | **str**| The repository id | 
 **hash** | **str**| The object&#39;s hash | 

### Return type

[**TagObject**](TagObject.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Tag retrieved successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_get_tree**
> TreeObject handle_get_tree(repo, hash)

Get a tree object

Get a tree from the Git database with its entries.

### Example


```python
import freestyle_client
from freestyle_client.models.tree_object import TreeObject
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
    api_instance = freestyle_client.GitApi(api_client)
    repo = 'repo_example' # str | The repository id
    hash = 'hash_example' # str | The object's hash

    try:
        # Get a tree object
        api_response = api_instance.handle_get_tree(repo, hash)
        print("The response of GitApi->handle_get_tree:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GitApi->handle_get_tree: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo** | **str**| The repository id | 
 **hash** | **str**| The object&#39;s hash | 

### Return type

[**TreeObject**](TreeObject.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Tree retrieved successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_list_commits**
> CommitList handle_list_commits(repo, branch=branch, limit=limit, offset=offset)

List commits for a repository

List commits from the Git database for a specific repository and branch.

### Example


```python
import freestyle_client
from freestyle_client.models.commit_list import CommitList
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
    api_instance = freestyle_client.GitApi(api_client)
    repo = 'repo_example' # str | The repository id
    branch = 'main' # str | Branch name (defaults to HEAD) (optional)
    limit = 50 # int | Maximum number of commits to return (default: 50, max: 500) (optional)
    offset = 0 # int | Number of commits to skip (default: 0) (optional)

    try:
        # List commits for a repository
        api_response = api_instance.handle_list_commits(repo, branch=branch, limit=limit, offset=offset)
        print("The response of GitApi->handle_list_commits:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GitApi->handle_list_commits: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo** | **str**| The repository id | 
 **branch** | **str**| Branch name (defaults to HEAD) | [optional] 
 **limit** | **int**| Maximum number of commits to return (default: 50, max: 500) | [optional] 
 **offset** | **int**| Number of commits to skip (default: 0) | [optional] 

### Return type

[**CommitList**](CommitList.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Commits retrieved successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_list_git_triggers**
> HandleListGitTriggers200Response handle_list_git_triggers(repo)

List git triggers for a repository

List git triggers for the given repository.

### Example


```python
import freestyle_client
from freestyle_client.models.handle_list_git_triggers200_response import HandleListGitTriggers200Response
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
    api_instance = freestyle_client.GitApi(api_client)
    repo = 'repo_example' # str | The repository id

    try:
        # List git triggers for a repository
        api_response = api_instance.handle_list_git_triggers(repo)
        print("The response of GitApi->handle_list_git_triggers:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GitApi->handle_list_git_triggers: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo** | **str**| The repository id | 

### Return type

[**HandleListGitTriggers200Response**](HandleListGitTriggers200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**400** | Invalid request |  -  |
**403** | User does not have permission to access this repository |  -  |
**404** | Repository does not exist |  -  |
**500** | Internal server error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_list_repositories**
> ListRepositoriesSuccess handle_list_repositories(limit=limit, offset=offset)

List repositories

List repositories with metadata.

### Example


```python
import freestyle_client
from freestyle_client.models.list_repositories_success import ListRepositoriesSuccess
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
    api_instance = freestyle_client.GitApi(api_client)
    limit = 56 # int | Maximum number of repositories to return (optional)
    offset = 56 # int | Offset for the list of repositories (optional)

    try:
        # List repositories
        api_response = api_instance.handle_list_repositories(limit=limit, offset=offset)
        print("The response of GitApi->handle_list_repositories:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GitApi->handle_list_repositories: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **limit** | **int**| Maximum number of repositories to return | [optional] 
 **offset** | **int**| Offset for the list of repositories | [optional] 

### Return type

[**ListRepositoriesSuccess**](ListRepositoriesSuccess.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of repositories |  -  |
**500** | Error: Internal |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_set_default_branch**
> object handle_set_default_branch(repo_id, set_default_branch_request)

Set repository default branch

Set the default branch name for a repository. This will update the HEAD reference to point to the new default branch.

### Example


```python
import freestyle_client
from freestyle_client.models.set_default_branch_request import SetDefaultBranchRequest
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
    api_instance = freestyle_client.GitApi(api_client)
    repo_id = 'repo_id_example' # str | The repository ID
    set_default_branch_request = freestyle_client.SetDefaultBranchRequest() # SetDefaultBranchRequest | 

    try:
        # Set repository default branch
        api_response = api_instance.handle_set_default_branch(repo_id, set_default_branch_request)
        print("The response of GitApi->handle_set_default_branch:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GitApi->handle_set_default_branch: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo_id** | **str**| The repository ID | 
 **set_default_branch_request** | [**SetDefaultBranchRequest**](SetDefaultBranchRequest.md)|  | 

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
**200** | Success |  -  |
**403** | Error: Forbidden |  -  |
**404** | Error: RepoNotFound |  -  |
**500** | Error: Internal |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **remove_github_sync**
> remove_github_sync(repo_id)

Remove GitHub sync configuration

Remove GitHub sync configuration from a repository. This stops automatic syncing but doesn't affect the repository content.

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
    api_instance = freestyle_client.GitApi(api_client)
    repo_id = 'repo_id_example' # str | Repository ID

    try:
        # Remove GitHub sync configuration
        api_instance.remove_github_sync(repo_id)
    except Exception as e:
        print("Exception when calling GitApi->remove_github_sync: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo_id** | **str**| Repository ID | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | GitHub sync configuration removed successfully |  -  |
**404** | Repository or sync configuration not found |  -  |
**500** | Internal server error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **update_dev_server_configuration**
> update_dev_server_configuration(repo_id, update_dev_server_config_request)

Update dev server configuration

Update the dev server configuration for a repository and branch.

### Example


```python
import freestyle_client
from freestyle_client.models.update_dev_server_config_request import UpdateDevServerConfigRequest
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
    api_instance = freestyle_client.GitApi(api_client)
    repo_id = 'repo_id_example' # str | Repository ID
    update_dev_server_config_request = freestyle_client.UpdateDevServerConfigRequest() # UpdateDevServerConfigRequest | 

    try:
        # Update dev server configuration
        api_instance.update_dev_server_configuration(repo_id, update_dev_server_config_request)
    except Exception as e:
        print("Exception when calling GitApi->update_dev_server_configuration: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repo_id** | **str**| Repository ID | 
 **update_dev_server_config_request** | [**UpdateDevServerConfigRequest**](UpdateDevServerConfigRequest.md)|  | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: Not defined

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Dev server configuration updated successfully |  -  |
**404** | Repository not found |  -  |
**500** | Internal server error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

